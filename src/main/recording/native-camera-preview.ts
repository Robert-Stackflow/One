import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

/** A bounded in-memory JPEG stream; no recording, audio, or temporary camera files. */
export class NativeCameraPreview {
  private child: ChildProcessWithoutNullStreams;
  private bytes = Buffer.alloc(0);
  private latest?: Buffer;
  private ended = false;
  private failure = '';
  readonly ready: Promise<void>;
  private completion: Promise<void>;
  constructor(device: string, launch = spawn, fixture = false) {
    this.child = launch(
      join(__dirname, '../native/One.RecordingVideo.exe').replace('app.asar', 'app.asar.unpacked'),
      [fixture ? 'camera-preview-test' : 'camera-preview', device, String(process.pid)],
      { windowsHide: true, stdio: 'pipe' },
    ) as ChildProcessWithoutNullStreams;
    this.child.stdin.on('error', () => {});
    this.completion = new Promise((resolve) =>
      this.child.once('close', () => {
        this.ended = true;
        this.latest = undefined;
        resolve();
      }),
    );
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Error('摄像头预览超时，请检查设备占用或隐私设置'));
        void this.stop();
      }, 8000);
      const fail = (message: string) => {
        clearTimeout(timer);
        reject(Error(message));
      };
      this.child.once('error', (error) => fail(error.message));
      this.child.once('close', () => fail(this.failure || '摄像头预览已关闭'));
      this.child.stdout.on('data', (chunk: Buffer) => {
        if (this.ended) return;
        this.bytes = Buffer.concat([this.bytes, chunk]);
        while (this.bytes.length >= 4) {
          const size = this.bytes.readUInt32LE(0);
          if (size < 4 || size > 2 * 1024 * 1024) {
            fail('摄像头预览数据无效');
            void this.stop();
            return;
          }
          if (this.bytes.length < size + 4) break;
          this.latest = Buffer.from(this.bytes.subarray(4, size + 4));
          this.bytes = this.bytes.subarray(size + 4);
          clearTimeout(timer);
          resolve();
        }
      });
      this.child.stderr.on('data', (chunk: Buffer) => {
        this.failure = (this.failure + chunk.toString('utf8')).slice(-1000);
      });
    });
    void this.ready.catch(() => {});
  }
  frame() {
    if (this.ended || !this.latest) throw Error(this.failure || '摄像头画面尚未就绪');
    return this.latest;
  }
  async stop() {
    if (!this.ended) {
      this.ended = true;
      this.latest = undefined;
      this.bytes = Buffer.alloc(0);
      this.child.stdin.end('stop\n');
      const timer = setTimeout(() => this.child.kill(), 1500);
      await this.completion;
      clearTimeout(timer);
    } else await this.completion;
  }
}
