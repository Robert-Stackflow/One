import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { ocrDimensions, ocrLanguage, ocrResult, type OCRResult } from '../../shared/recognition/ocr';
import type { PaddleModelFiles, PaddlePreferences, PaddleJob } from './paddle-job';

export interface PaddleTaskResult extends OCRResult { actualBackend: 'cpu' | 'dml'; deviceId?: number; fallbackReason?: string }
class InferenceError extends Error { constructor(message: string, readonly kind: string) { super(message); } }
/** One isolated process/cache per owner. Killing a task releases native ONNX/DML resources with the process. */
export class PaddleRunner {
  private child?: ChildProcess;
  private abort?: AbortController;
  private active?: Promise<PaddleTaskResult>;
  private serial = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(private worker = join(__dirname, 'recognition/paddle-worker.cjs'), private timeoutMs = 90000, private idleMs = 60000) {}
  private async terminate() {
    clearTimeout(this.idle);
    const child = this.child; this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
  }
  async cancel() { this.abort?.abort(); await this.active?.catch(() => {}); }
  async close() { this.closed = true; await this.cancel(); await this.terminate(); }
  run(png: Buffer, size: { width: number; height: number }, language: 'eng' | 'chi_sim+eng', model: PaddleModelFiles,
      preferences: PaddlePreferences, progress: (value: number, phase: string) => void = () => {}): Promise<PaddleTaskResult> {
    if (this.closed) return Promise.reject(Error('OCR 推理服务已关闭'));
    if (this.active) return Promise.reject(Error('正在识别，请先取消当前任务'));
    ocrDimensions(size.width, size.height); ocrLanguage(language);
    if (!Buffer.isBuffer(png) || png.length < 24 || png.length > 64 * 1024 * 1024) throw Error('OCR 原图数据无效');
    if (!['auto', 'cpu', 'gpu'].includes(preferences.device) || !Number.isSafeInteger(preferences.deviceId) || preferences.deviceId < 0 || preferences.deviceId > 31 ||
        preferences.memoryMiB !== undefined && (!Number.isSafeInteger(preferences.memoryMiB) || preferences.memoryMiB < 128 || preferences.memoryMiB > 8192)) throw Error('OCR 推理设备或内存预算无效');
    const snapshot = structuredClone(model), dimensions = { ...size }, input = Buffer.from(png), prefs = { ...preferences }, signal = (this.abort = new AbortController()).signal;
    const backend = prefs.device === 'gpu' || prefs.device === 'auto' && dimensions.width * dimensions.height >= 1_000_000 ? 'dml' : 'cpu';
    clearTimeout(this.idle);
    const task = (async () => {
      try { return await this.execute(input, dimensions, language, snapshot, prefs, backend, signal, progress); }
      catch (error) {
        if (signal.aborted || prefs.device !== 'auto' || backend !== 'dml' || !(error instanceof InferenceError) || !['loading', 'inference', 'resource', 'exit', 'timeout'].includes(error.kind)) {
          if (!signal.aborted && prefs.device === 'gpu' && error instanceof InferenceError && ['loading', 'inference', 'resource', 'exit', 'timeout'].includes(error.kind))
            error.message += '；输入已保留，可切换 CPU 重试';
          throw error;
        }
        await this.terminate(); signal.throwIfAborted();
        progress(0, 'cpu-fallback');
        const result = await this.execute(input, dimensions, language, snapshot, prefs, 'cpu', signal, progress);
        result.fallbackReason = error.message; return result;
      }
    })();
    this.active = task;
    return task.finally(() => {
      input.fill(0);
      if (this.active === task) {
        this.active = undefined; this.abort = undefined;
        if (!this.closed) { this.idle = setTimeout(() => void this.terminate(), this.idleMs); this.idle.unref(); }
      }
    });
  }
  private execute(png: Buffer, size: { width: number; height: number }, language: 'eng' | 'chi_sim+eng', model: PaddleModelFiles,
      prefs: PaddlePreferences, backend: 'cpu' | 'dml', signal: AbortSignal, progress: (value: number, phase: string) => void) {
    signal.throwIfAborted();
    if (this.child && (!this.child.connected || this.child.exitCode !== null || this.child.signalCode !== null)) this.child = undefined;
    if (!this.child) {
      const owned = this.child = fork(this.worker, [], { execArgv: ['--max-old-space-size=384'], serialization: 'advanced',
        windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      owned.on('error', () => {});
      owned.once('exit', () => { if (this.child === owned) this.child = undefined; });
    }
    const child = this.child;
    const id = ++this.serial;
    return new Promise<PaddleTaskResult>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error, result?: PaddleTaskResult) => {
        if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        child.off('message', message); child.off('exit', exit); child.off('error', failed);
        if (error) void this.terminate().then(() => reject(error), () => reject(error)); else resolve(result!);
      };
      const cancel = () => finish(new InferenceError('文字识别已取消', 'cancelled'));
      const exit = (code: number | null) => finish(new InferenceError(code === 70 ? 'OCR 推理超过内存预算，输入已保留' : 'OCR 推理进程退出，请重试', code === 70 ? 'resource' : 'exit'));
      const failed = () => finish(new InferenceError('OCR 推理进程无法启动', 'exit'));
      const message = (packet: any) => {
        if (packet?.id !== id || done) return;
        if (packet.phase && Number.isFinite(packet.progress)) { progress(Math.max(0, Math.min(1, packet.progress)), String(packet.phase)); return; }
        if (!packet.ok) { finish(new InferenceError(typeof packet.error === 'string' ? packet.error.slice(0, 1000) : 'OCR 推理失败', String(packet.kind))); return; }
        try {
          const value = ocrResult(packet.result, size, language);
          // The child is owned by this service; preserve its source-bound document, not arbitrary renderer input.
          value.document = packet.result.document;
          finish(undefined, { ...value, actualBackend: backend, deviceId: backend === 'dml' ? prefs.deviceId : undefined });
        } catch { finish(new InferenceError('OCR 推理结果无效', 'result')); }
      };
      const timer = setTimeout(() => finish(new InferenceError('文字识别超时，输入已保留，请重试', 'timeout')), this.timeoutMs);
      signal.addEventListener('abort', cancel, { once: true }); child.on('message', message); child.once('exit', exit); child.once('error', failed);
      // Drain diagnostics without exposing image text or allowing stderr to block the inference process.
      child.stderr?.resume();
      child.send({ id, png, language, model, backend, deviceId: prefs.deviceId, memoryMiB: prefs.memoryMiB ?? 1536 } satisfies PaddleJob,
        error => { if (error) failed(); });
      if (signal.aborted) cancel();
    });
  }
}
