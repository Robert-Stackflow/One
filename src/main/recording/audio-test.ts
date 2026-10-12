import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { limitChildProcess } from '../capture/native';
import type { AudioTestState, RecordingAudioSource } from '../../shared/recording/recording';

type Launch = (executable: string, args: string[]) => ChildProcessWithoutNullStreams;
/** Live endpoint sampling only: no recorder, audio playback, files or material projects. */
export class AudioTestManager {
  private sessions = new Map<RecordingAudioSource, { stop(): Promise<void> }>();
  private queues = new Map<RecordingAudioSource, Promise<void>>();
  private generation = 0;
  constructor(
    private update: (state: AudioTestState) => void,
    private allowed: () => boolean,
    private launch: Launch = (file, args) =>
      spawn(file, args, { windowsHide: true, stdio: 'pipe' }),
  ) {}
  set(channel: unknown, enabled: unknown, device: unknown): Promise<void> {
    if (
      (channel !== 'system' && channel !== 'microphone') ||
      typeof enabled !== 'boolean' ||
      typeof device !== 'string' ||
      device.length > 1000 ||
      /[\x00-\x1f]/.test(device)
    )
      return Promise.reject(Error('声音测试参数无效'));
    if (!enabled) void this.sessions.get(channel)?.stop();
    const generation = this.generation;
    const change = async () => {
      await this.sessions.get(channel)?.stop();
      if (!enabled || generation !== this.generation) return;
      if (!this.allowed()) throw Error('当前无法测试声音，请先完成录制操作');
      await this.start(channel, device || 'default');
    };
    const queued = (this.queues.get(channel) || Promise.resolve()).then(change, change);
    this.queues.set(channel, queued);
    void queued
      .finally(() => {
        if (this.queues.get(channel) === queued) this.queues.delete(channel);
      })
      .catch(() => {});
    return queued;
  }
  async stopAll() {
    ++this.generation;
    await Promise.all(['system', 'microphone'].map((channel) => this.set(channel, false, '')));
  }
  private start(channel: RecordingAudioSource, device: string): Promise<void> {
    this.update({ channel, status: 'starting', level: 0 });
    const executable = join(__dirname, '../native/One.RecordingAudio.exe').replace(
      'app.asar',
      'app.asar.unpacked',
    );
    const child = this.launch(executable, ['monitor', channel, device, String(process.pid)]);
    let buffer = '',
      diagnostics = '',
      ended = false,
      stopping = false,
      initialized = false;
    let release: (() => void) | undefined, closeResolve!: () => void;
    const closed = new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const startup = setTimeout(() => fail(Error('声音测试启动超时')), 8000);
    startup.unref();
    const lifetime = setTimeout(() => {
      void session.stop();
    }, 120000);
    lifetime.unref();
    const finish = (error?: Error) => {
      if (ended) return;
      ended = true;
      clearTimeout(startup);
      clearTimeout(lifetime);
      release?.();
      if (this.sessions.get(channel) === session) this.sessions.delete(channel);
      if (!initialized) rejectReady(error || Error('声音测试已停止'));
      this.update({
        channel,
        status: error && !stopping ? 'error' : 'idle',
        level: 0,
        ...(error && !stopping ? { message: error.message.slice(0, 240) } : {}),
      });
    };
    const fail = (error: Error) => {
      child.kill();
      finish(error);
    };
    const session = {
      stop: async () => {
        if (ended || stopping) return closed;
        stopping = true;
        child.stdin.end('stop\n');
        const timeout = setTimeout(() => child.kill(), 800);
        timeout.unref();
        await closed;
        clearTimeout(timeout);
      },
    };
    this.sessions.set(channel, session);
    child.once('spawn', () => {
      try {
        release = limitChildProcess(child.pid!, 128);
      } catch (error) {
        fail(error as Error);
      }
    });
    child.stdin.on('error', () => {});
    child.stderr.on('data', (data) => {
      diagnostics = (diagnostics + data.toString()).slice(-1000);
    });
    child.stdout.on('data', (data) => {
      if (ended || stopping) return;
      buffer += data.toString();
      if (buffer.length > 8192) return fail(Error('声音测试响应异常'));
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.kind === 'ready' && !initialized) {
            initialized = true;
            clearTimeout(startup);
            resolveReady();
            this.update({ channel, status: 'active', level: 0 });
          } else if (
            event.kind === 'level' &&
            initialized &&
            Number.isFinite(event.value) &&
            event.value >= 0 &&
            event.value <= 1
          ) {
            this.update({ channel, status: 'active', level: event.value });
          } else throw Error('声音测试响应异常');
        } catch (error) {
          fail(error as Error);
          break;
        }
      }
    });
    child.once('error', (error) => {
      finish(error);
      closeResolve();
    });
    child.once('close', (code) => {
      finish(
        code && !stopping
          ? Error(diagnostics.trim() || '声音设备不可用，请检查权限或重新选择设备')
          : undefined,
      );
      closeResolve();
    });
    return ready;
  }
}
