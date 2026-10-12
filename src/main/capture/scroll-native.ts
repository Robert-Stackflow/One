import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { screen } from 'electron';
import { NativeFrameReader } from '../../shared/capture/native-frame';
import { IMAGE_BYTES, imageDimensions } from '../../shared/capture/image-limits';
import { limitChildProcess, nativeMonitorBounds } from './native';
export function captureMonitorBounds(display: Electron.Display) {
  const { x, y, width, height } = display.bounds;
  return nativeMonitorBounds(
    screen.dipToScreenPoint({
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2),
    }),
  );
}
/** One pending command/response and one owned native session. No unbounded stream buffer. */
export class ScrollNative {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private reader?: NativeFrameReader;
  private diagnostics = '';
  private release?: () => void;
  private pending?: {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  };
  private stopped = false;
  private failure?: Error;
  private hasFrame = false;
  /** Time through GPU readback, excluding PNG encoding and pipe transport. */
  lastReadbackMs = 0;
  readonly ready: Promise<void>;
  constructor(target: Electron.Rectangle | { hwnd: number; pid: number }, snapshotOnly = false) {
    let args: string[];
    if ('hwnd' in target) {
      if (
        ![target.hwnd, target.pid].every(Number.isSafeInteger) ||
        target.hwnd <= 0 ||
        target.pid <= 0 ||
        target.pid === process.pid
      )
        throw Error('窗口采集身份无效');
      args = ['window', String(target.hwnd), String(target.pid), String(process.pid)];
    } else {
      imageDimensions(target.width, target.height);
      if (![target.x, target.y, target.width, target.height].every(Number.isSafeInteger))
        throw Error('长截图区域无效');
      args = [
        String(target.x),
        String(target.y),
        String(target.x + target.width),
        String(target.y + target.height),
        String(process.pid),
        ...(snapshotOnly ? ['snapshot'] : []),
      ];
    }
    this.child = spawn(
      join(__dirname, '../native/One.ScrollCapture.exe').replace('app.asar', 'app.asar.unpacked'),
      args,
      { windowsHide: true, stdio: 'pipe' },
    );
    this.ready = this.response().then((value: any) => {
      if (value.ready !== true) throw Error('原生采集未就绪');
    });
    this.child.once('spawn', () => {
      if (this.stopped) return;
      try {
        this.release = limitChildProcess(this.child.pid!, 1024);
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return;
      try {
        if (!this.pending) throw Error('原生采集返回意外响应');
        if (this.reader) {
          this.reader.append(chunk);
          if (this.reader.complete) this.frameComplete();
          return;
        }
        const newline = chunk.indexOf(10);
        if (this.buffer.length + (newline < 0 ? chunk.length : newline) > 512)
          throw Error('采集响应头过大');
        this.buffer = Buffer.concat([
          this.buffer,
          newline < 0 ? chunk : chunk.subarray(0, newline + 1),
        ]);
        const end = this.buffer.indexOf(10);
        if (end < 0) return;
        if (end > 512) throw Error('采集响应头过大');
        const header = JSON.parse(this.buffer.subarray(0, end).toString('utf8'));
        if ('bytes' in header) {
          imageDimensions(header.width, header.height);
          if (
            !Number.isSafeInteger(header.bytes) ||
            header.bytes < 24 ||
            header.bytes > IMAGE_BYTES
          )
            throw Error('采集图像容量无效');
          this.reader = new NativeFrameReader();
          this.reader.append(this.buffer);
          this.buffer = Buffer.alloc(0);
          this.reader.append(chunk.subarray(newline + 1));
          if (this.reader.complete) this.frameComplete();
        } else {
          if (
            chunk.length !== newline + 1 ||
            !(
              header.ready === true ||
              typeof header.scroll === 'boolean' ||
              typeof header.focused === 'boolean'
            )
          )
            throw Error('采集响应无效');
          this.complete(header);
        }
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (s: string) => {
      this.diagnostics = (this.diagnostics + s).slice(-2048);
    });
    this.child.once('error', (e) => this.fail(e));
    this.child.stdin.on('error', (e) => this.fail(e));
    this.child.once('close', (code) => {
      this.release?.();
      this.release = undefined;
      if (!this.stopped) this.fail(Error(this.diagnostics.trim() || '原生采集退出：' + code));
    });
  }
  private response() {
    if (this.stopped) return Promise.reject(this.failure || Error('长截图已结束'));
    if (this.pending) return Promise.reject(Error('采集正在进行'));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(Error('长截图采集超时')), 8000);
      timer.unref();
      this.pending = { resolve, reject, timer };
    });
  }
  private complete(value: unknown) {
    const pending = this.pending!;
    this.pending = undefined;
    clearTimeout(pending.timer);
    this.buffer = Buffer.alloc(0);
    this.reader = undefined;
    pending.resolve(value);
  }
  private frameComplete() {
    const { info, png } = this.reader!.finish();
    this.lastReadbackMs = info.elapsed;
    this.hasFrame = true;
    this.complete(png);
  }
  private fail(error: unknown) {
    this.failure ||= error instanceof Error ? error : Error(String(error));
    this.stop();
  }
  async frame(fresh = false): Promise<Buffer> {
    await this.ready;
    const response = this.response();
    this.child.stdin.write(fresh && this.hasFrame ? 'frame fresh\n' : 'frame\n');
    const value = await response;
    if (!Buffer.isBuffer(value)) throw Error('原生图像响应无效');
    return value;
  }
  async wheel(horizontal: boolean) {
    await this.ready;
    const response = this.response();
    this.child.stdin.write(horizontal ? 'wheel h 120\n' : 'wheel v -120\n');
    const value = (await response) as { scroll: boolean };
    return value.scroll === true;
  }
  async focused() {
    await this.ready;
    const response = this.response();
    this.child.stdin.write('guard\n');
    return ((await response) as { focused: boolean }).focused === true;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failure || Error('长截图已取消'));
      this.pending = undefined;
    }
    this.buffer.fill(0);
    this.buffer = Buffer.alloc(0);
    this.reader = undefined;
    this.child.kill();
    this.release?.();
    this.release = undefined;
  }
}
