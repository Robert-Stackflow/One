import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { readFile, realpath, lstat, rm, open } from 'node:fs/promises';
import { limitChildProcess } from '../capture/native';
import { audioEvent, type AudioProgress, type AudioResult } from '../../shared/recording/native-audio';
import type { RecordingFile } from './recording-file';
import { validateAudioSource } from './recording-audio';
import type { RecordingAudioSource } from '../../shared/recording/recording';
export interface NativeMediaConfig {
  executable: string;
  args: string[];
  marker: string;
  markerText: string;
  memoryMB?: number;
  ready?(value: unknown): void;
  event?(value: unknown): boolean;
  acknowledged?(value: unknown, command: string): void;
}
/** A bounded, acknowledged native recording session shared by audio and video. */
export class NativeMedia {
  private child: ChildProcessWithoutNullStreams;
  private release?: () => void;
  private diagnostics = '';
  private buffer = '';
  private id = 0;
  private pending?: {
    id: number;
    paused: boolean;
    command: string;
    resolve(): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  };
  private result?: AudioResult;
  private stopped = false;
  private failure?: Error;
  private completed = false;
  private commandStop = false;
  private initialized = false;
  private samples = 0;
  private controlDone?: Promise<void>;
  private queuedControls = 0;
  private paused = false;
  private disposal?: Promise<void>;
  private closeResolve!: () => void;
  private readonly closed: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready: Promise<void>;
  private doneResolve!: (value: AudioResult) => void;
  private doneReject!: (error: Error) => void;
  readonly done: Promise<AudioResult>;
  private timer: NodeJS.Timeout;
  protected constructor(
    readonly directory: string,
    readonly file: string,
    private readonly config: NativeMediaConfig,
    update: (event: AudioProgress) => void,
    launch?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams,
  ) {
    this.closed = new Promise((resolve) => {
      this.closeResolve = resolve;
    });
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.done = new Promise((resolve, reject) => {
      this.doneResolve = resolve;
      this.doneReject = reject;
    });
    void this.ready.catch(() => {});
    void this.done.catch(() => {});
    this.timer = setTimeout(() => this.fail(Error('原生录制初始化超时')), 12000);
    this.timer.unref();
    this.child = launch
      ? launch(config.executable, config.args)
      : spawn(config.executable, config.args, { windowsHide: true, stdio: 'pipe' });
    this.child.once('spawn', () => {
      if (this.stopped) return;
      try {
        this.release = limitChildProcess(this.child.pid!, config.memoryMB || 512);
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (text: string) => {
      if (this.stopped) return;
      try {
        // Several bounded event lines may be delivered in one pipe read.
        if (this.buffer.length + text.length > 131072) throw Error('录制状态响应过大');
        this.buffer += text;
        for (;;) {
          const end = this.buffer.indexOf('\n');
          if (end < 0) {
            if (this.buffer.length > 4096) throw Error('录制状态响应过大');
            break;
          }
          if (end > 4096) throw Error('录制状态响应过大');
          const value = JSON.parse(this.buffer.slice(0, end));
          this.buffer = this.buffer.slice(end + 1);
          if (value.kind === 'ready' && value.rate === 48000 && value.channels === 2) {
            if (this.initialized || this.result) throw Error('录制初始化响应重复');
            config.ready?.(value);
            this.initialized = true;
            clearTimeout(this.timer);
            this.readyResolve();
          } else if (
            value.kind === 'ack' &&
            this.initialized &&
            value.id === this.pending?.id &&
            value.paused === this.pending?.paused
          ) {
            const progress = audioEvent({ ...value, kind: 'progress' }) as AudioProgress;
            if (progress.samples < this.samples) throw Error('录制时钟倒退');
            config.acknowledged?.(value, this.pending!.command);
            this.samples = progress.samples;
            update(progress);
            this.paused = value.paused;
            const pending = this.pending!;
            this.pending = undefined;
            clearTimeout(pending.timer);
            pending.resolve();
          } else {
            if (!this.initialized || this.result) throw Error('录制状态顺序无效');
            if (config.event?.(value)) continue;
            const event = audioEvent(value);
            if (event.samples < this.samples) throw Error('录制时钟倒退');
            this.samples = event.samples;
            if (event.kind === 'done') this.result = event;
            else update(event);
          }
        }
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (value: string) => {
      this.diagnostics = (this.diagnostics + value).slice(-2048);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.once('close', (code) => {
      clearTimeout(this.timer);
      this.release?.();
      this.release = undefined;
      this.closeResolve();
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(Error('录制已经结束'));
        this.pending = undefined;
      }
      if (!this.stopped && code === 0 && this.result) {
        this.completed = true;
        this.doneResolve(this.result);
      } else if (!this.stopped) this.fail(Error(this.diagnostics.trim() || '原生录制未正常结束'));
    });
  }
  get retryable() {
    return this.completed;
  }
  get terminal() {
    return this.completed || !!this.failure;
  }
  protected get sealSource() {
    return this.file;
  }
  protected retainResult(result: AudioResult) {
    this.result = result;
    this.completed = true;
  }
  waitClosed() {
    return this.closed;
  }
  private fail(value: unknown) {
    if (this.stopped) return;
    this.failure = value instanceof Error ? value : Error(String(value));
    this.stopped = true;
    clearTimeout(this.timer);
    this.readyReject(this.failure);
    this.doneReject(this.failure);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failure);
      this.pending = undefined;
    }
    this.child.kill();
  }
  protected control(command: string, expectedPaused?: boolean) {
    if (this.stopped || this.commandStop || this.completed)
      return Promise.reject(Error('录制已经结束'));
    if (this.queuedControls >= 8) return Promise.reject(Error('录制操作过于频繁'));
    this.queuedControls++;
    const previous = this.controlDone;
    const result = (async () => {
      await this.ready;
      await previous;
      if (this.stopped || this.completed) throw this.failure || Error('录制已经结束');
      const id = ++this.id;
      const acknowledged = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => this.fail(Error('录制控制超时')), 5000);
        timer.unref();
        this.pending = {
          id,
          command,
          paused: expectedPaused ?? this.paused,
          resolve,
          reject,
          timer,
        };
      });
      const [verb, ...args] = command.split(' ');
      this.child.stdin.write(`${verb} ${id}${args.length ? ' ' + args.join(' ') : ''}\n`);
      await acknowledged;
    })();
    this.controlDone = result;
    void result
      .finally(() => {
        this.queuedControls--;
        if (this.controlDone === result) this.controlDone = undefined;
      })
      .catch(() => {});
    return result;
  }
  pause(paused: boolean) {
    if (typeof paused !== 'boolean') return Promise.reject(Error('暂停状态无效'));
    return this.control(paused ? 'pause' : 'resume', paused);
  }
  protected get positionSamples() {
    return this.samples;
  }
  gain(system: number, microphone: number) {
    if (![system, microphone].every((value) => Number.isFinite(value) && value >= 0 && value <= 2))
      return Promise.reject(Error('音量须在 0–200% 之间'));
    return this.control(`gain ${system} ${microphone}`);
  }
  async finish() {
    if (this.completed) return this.result!;
    await this.ready;
    if (!this.commandStop && !this.completed && !this.stopped) {
      this.commandStop = true;
      await this.controlDone;
      if (this.stopped) return this.done;
      this.timer = setTimeout(() => this.fail(Error('录制封装超时，原始暂存已保留')), 15000);
      this.timer.unref();
      this.child.stdin.write('stop 0\n');
    }
    return this.done;
  }
  async seal(file: RecordingFile, valid: () => boolean) {
    if (!this.completed) throw Error('录制尚未完成封装');
    if (!this.result!.samples) throw Error('没有可保存的录制内容');
    return this.sealFile(file, this.sealSource, this.result!.bytes, valid);
  }
  async sealAudioSource(source: RecordingAudioSource, file: RecordingFile, valid: () => boolean) {
    if (!this.completed || !this.result?.samples) throw Error('独立声源尚未完成封装');
    if (source !== 'system' && source !== 'microphone') throw Error('独立声源无效');
    const path = this.file + '.' + source + '.wav',
      handle = await open(path, 'r');
    let bytes = 0;
    try {
      bytes = (await handle.stat()).size;
      const header = Buffer.alloc(44),
        read = await handle.read(header, 0, 44, 0);
      validateAudioSource(header.subarray(0, read.bytesRead), bytes, this.result.samples);
    } finally {
      await handle.close();
    }
    return this.sealFile(file, path, bytes, valid);
  }
  protected async sealFile(
    file: RecordingFile,
    source: string,
    bytes: number,
    valid: () => boolean,
  ) {
    if (!(await lstat(source)).isFile() || (await lstat(source)).isSymbolicLink())
      throw Error('录制暂存文件无效');
    const handle = await open(source, 'r');
    try {
      const info = await handle.stat();
      if (info.size !== bytes || info.size > 1024 ** 3 || info.size < 44)
        throw Error('录制暂存大小无效');
      const buffer = Buffer.alloc(2 * 1024 * 1024);
      let position = 0,
        index = 0;
      try {
        while (position < info.size) {
          if (!valid()) throw Error('录制已取消');
          const read = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, info.size - position),
            position,
          );
          if (!read.bytesRead) throw Error('录制暂存不完整');
          await file.append(index++, buffer.subarray(0, read.bytesRead));
          position += read.bytesRead;
        }
        if (!valid()) throw Error('录制已取消');
        await file.finish();
      } finally {
        buffer.fill(0);
      }
    } finally {
      await handle.close();
    }
  }
  dispose(): Promise<void> {
    return (this.disposal ||= this.disposeOnce());
  }
  protected async settleWrites() {}
  private async disposeOnce() {
    if (!this.stopped && !this.completed) this.fail(Error('录制已取消'));
    await this.closed;
    await this.settleWrites();
    const actual = await realpath(this.directory),
      root = resolve(this.directory, '..');
    if (
      actual !== resolve(this.directory) ||
      !actual.startsWith(root + sep) ||
      (await readFile(join(actual, this.config.marker), 'utf8')) !== this.config.markerText
    )
      throw Error('录制临时目录校验失败');
    await rm(actual, { recursive: true, force: true });
  }
}
