import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { limitChildProcess } from './native';
import type { Point } from '../../shared/capture/image-document';

interface Query {
  point: Point;
  serial: number;
  resolve(value: unknown[]): void;
  update(value: unknown[], partial: boolean): void;
  fallback: unknown[];
}
/** One isolated UIA provider call at a time; only the most recent queued pointer is retained. */
export class CaptureProbe {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private abortStartup?: () => void;
  private current?: Query;
  private queued?: Query;
  private timer?: ReturnType<typeof setTimeout>;
  private serial = 0;
  private closed = false;
  private backoff = 0;
  private release?: () => void;
  constructor(
    private failed: (error: unknown) => void,
    private launch?: () => ChildProcessWithoutNullStreams,
    private excludedWindow?: string,
  ) {}
  warm() {
    void this.open().catch(() => {});
  }
  private open(): Promise<void> {
    if (this.closed) return Promise.reject(Error('截图已结束'));
    if (this.starting) return this.starting;
    if (this.child) return Promise.resolve();
    if (Date.now() < this.backoff) return Promise.reject(Error('元素查询暂不可用'));
    const child = this.launch
      ? this.launch()
      : spawn(
          join(__dirname, '../native/One.CaptureProbe.exe').replace('app.asar', 'app.asar.unpacked'),
          [String(process.pid), ...(this.excludedWindow ? [this.excludedWindow] : [])],
          { windowsHide: true, stdio: 'pipe' },
        );
    this.child = child;
    const starting = new Promise<void>((resolve, reject) => {
      let ready = false,
        buffer = '',
        diagnostics = '';
      const startup = setTimeout(() => fail(Error('元素查询启动超时')), 1500);
      this.abortStartup = () => {
        clearTimeout(startup);
        if (!ready) reject(Error('截图已结束'));
      };
      const fail = (error: unknown) => {
        if (this.child !== child) return;
        clearTimeout(startup);
        if (!ready) reject(error);
        this.failed(error);
        this.backoff = Date.now() + 2000;
        this.reset(child);
      };
      if (!this.launch)
        child.once('spawn', () => {
          if (this.child !== child) return;
          try {
            this.release = limitChildProcess(child.pid!, 512);
          } catch (error) {
            fail(error);
          }
        });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (value) => {
        diagnostics = (diagnostics + value).slice(-2048);
      });
      child.stdin.on('error', fail);
      child.once('error', fail);
      child.once('close', (code) => {
        if (this.child === child) fail(Error('元素查询进程退出：' + code + ' ' + diagnostics));
      });
      child.stdout.on('data', (value) => {
        if (this.child !== child) return;
        buffer += value;
        if (buffer.length > 65536) {
          fail(Error('元素查询结果过大'));
          return;
        }
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          try {
            const data = JSON.parse(line);
            if (!ready) {
              if (data.ready !== true) throw Error('元素查询初始化无效');
              ready = true;
              clearTimeout(startup);
              resolve();
              continue;
            }
            const active = this.current;
            if (
              !active ||
              data.serial !== active.serial ||
              !Array.isArray(data.candidates) ||
              data.candidates.length > 24 ||
              !['window', 'progress', 'ok', 'partial', 'empty'].includes(data.status)
            )
              throw Error('元素查询响应无效');
            active.fallback = data.candidates;
            active.resolve(data.candidates);
            active.update(data.candidates, ['window', 'progress', 'partial'].includes(data.status));
            if (!['window', 'progress'].includes(data.status)) {
              clearTimeout(this.timer);
              this.current = undefined;
              const next = this.queued;
              this.queued = undefined;
              if (next) this.send(next);
            }
          } catch (error) {
            fail(error);
            return;
          }
        }
      });
    });
    this.starting = starting;
    void starting.then(
      () => {
        if (this.starting === starting) this.starting = undefined;
      },
      () => {
        if (this.starting === starting) this.starting = undefined;
      },
    );
    return starting;
  }
  private send(query: Query) {
    if (!this.child || this.closed) {
      query.resolve([]);
      return;
    }
    this.current = query;
    this.timer = setTimeout(() => {
      this.failed(Error('元素查询超时，保留窗口框选'));
      this.backoff = Date.now() + 2000;
      this.reset(this.child);
    }, 1200);
    this.timer.unref();
    this.child.stdin.write(
      'probe ' + query.serial + ' ' + query.point.x + ' ' + query.point.y + '\n',
    );
  }
  async query(
    point: Point,
    update: (candidates: unknown[], partial: boolean) => void,
  ): Promise<unknown[]> {
    try {
      await this.open();
    } catch {
      return [];
    }
    if (this.closed) return [];
    return new Promise((resolve) => {
      const next = { point, serial: ++this.serial, resolve, update, fallback: [] };
      if (this.current) {
        this.queued?.resolve([]);
        this.queued = next;
      } else this.send(next);
    });
  }
  private reset(child?: ChildProcessWithoutNullStreams) {
    if (child && this.child !== child) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current?.resolve(this.current.fallback);
    this.queued?.resolve([]);
    this.current = this.queued = undefined;
    this.abortStartup?.();
    this.abortStartup = undefined;
    this.child = undefined;
    if (child && !child.killed) child.kill();
    this.release?.();
    this.release = undefined;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.reset(this.child);
  }
}
