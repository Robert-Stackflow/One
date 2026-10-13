import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import {
  ocrResult,
  ocrLanguage,
  ocrDimensions,
  type OCRLanguage,
  type OCRResult,
} from '../../shared/recognition/ocr';
import { OCRModels } from './ocr-models';
export class OCRRunner {
  private abort?: AbortController;
  private active?: Promise<OCRResult>;
  constructor(
    private models: OCRModels,
    private workerFile = join(__dirname, 'recognition/ocr-worker.cjs'),
    private timeout = 60000,
  ) {}
  async cancel() {
    this.abort?.abort();
    await this.active?.catch(() => {});
  }
  run(
    png: Buffer,
    size: { width: number; height: number },
    language: OCRLanguage,
    progress: (value: number) => void = () => {},
  ): Promise<OCRResult> {
    if (this.active) return Promise.reject(Error('正在识别，请先取消当前任务'));
    ocrDimensions(size.width, size.height);
    ocrLanguage(language);
    const abort = (this.abort = new AbortController());
    const task = (async () => {
      const packs = await this.models.prepare(language);
      let worker: Worker | undefined;
      try {
        if (abort.signal.aborted) throw Error('文字识别已取消');
        worker = new Worker(this.workerFile, {
          workerData: { png: Uint8Array.from(png), ...size, language, packs },
          resourceLimits: { maxOldGenerationSizeMb: 192 },
        });
        for (const pack of packs) pack.data.fill(0);
        return await new Promise<OCRResult>((resolve, reject) => {
          let done = false;
          const finish = (error?: Error, result?: OCRResult) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            abort.signal.removeEventListener('abort', cancel);
            void worker!.terminate().then(
              () => {
                error ? reject(error) : resolve(result!);
              },
              () => reject(error || Error('识别任务未完成')),
            );
          };
          const cancel = () => finish(Error('文字识别已取消'));
          const timer = setTimeout(
            () => finish(Error('文字识别超时，请先裁剪图片后重试')),
            this.timeout,
          );
          timer.unref();
          abort.signal.addEventListener('abort', cancel, { once: true });
          worker!.on('message', (message) => {
            if (done) return;
            if (message?.phase && Number.isFinite(message.progress)) {
              progress(
                message.phase === 'recognizing'
                  ? 0.1 + 0.9 * Math.max(0, Math.min(1, message.progress))
                  : 0.05,
              );
              return;
            }
            if (message?.ok) {
              try {
                finish(undefined, ocrResult(message.result, size, language));
              } catch (e) {
                finish(e as Error);
              }
            } else finish(Error('文字识别失败，请裁剪图片后重试'));
          });
          worker!.once('error', () => finish(Error('文字识别引擎无法启动，请重试')));
          worker!.once('exit', () => finish(Error('文字识别引擎已退出，请重试')));
        });
      } finally {
        for (const pack of packs) pack.data.fill(0);
      }
    })();
    this.active = task;
    return task.finally(() => {
      if (this.active === task) {
        this.active = undefined;
        this.abort = undefined;
      }
    });
  }
}
