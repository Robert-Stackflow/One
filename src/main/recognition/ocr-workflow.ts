import { randomUUID } from 'node:crypto';
import type { OCRResult, OCRWorkflowState, OCRWorkflowResult } from '../../shared/recognition/ocr';
import {
  translationLanguage,
  type TranslationConfig,
  type TranslationResult,
} from '../../shared/recognition/translation';
interface Host {
  prepare(png: Buffer): Promise<string>;
  valid(token: string): boolean;
  config(): Promise<TranslationConfig>;
  recognize(token: string): Promise<OCRResult>;
  translate(
    token: string,
    text: string,
    target: OCRWorkflowState['target'],
    revision: string,
  ): Promise<TranslationResult>;
  cancel(): Promise<void>;
}
/** Explicit capture action: local OCR then one configured translation request; no automatic retries. */
export class OCRWorkflow {
  owner?: string;
  state?: OCRWorkflowState;
  private output?: OCRWorkflowResult;
  private token = '';
  private task?: { owner: string; canceled: boolean; done: Promise<void>; finish(): void };
  constructor(private host: Host) {}
  get active() {
    return !!this.task;
  }
  async run(owner: string, png: Buffer, target: unknown): Promise<boolean> {
    if (this.task) throw Error('正在执行识别流程，请先取消当前任务');
    const language = translationLanguage(target),
      id = randomUUID();
    this.owner = owner;
    let finish!: () => void;
    const task = (this.task = {
      owner,
      canceled: false,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    });
    this.state = { id, target: language, status: 'recognizing', error: '' };
    this.token = '';
    this.output = { source: '', words: 0, confidence: 0 };
    const check = () => {
      if (task.canceled || !this.host.valid(this.token)) throw Error('识别流程已取消');
    };
    try {
      this.token = await this.host.prepare(png);
      check();
      const config = await this.host.config();
      check();
      if (!config.ready) throw Error(config.error || '请先在文字识别窗口配置翻译服务，再重试流程');
      const recognized = await this.host.recognize(this.token);
      check();
      this.output = {
        source: recognized.text,
        words: recognized.words.length,
        confidence: recognized.confidence,
      };
      this.state!.status = 'translating';
      const translated = await this.host.translate(
        this.token,
        recognized.text,
        language,
        config.revision,
      );
      check();
      this.output.translation = translated;
      this.state!.status = 'done';
      return true;
    } catch (error) {
      if (this.state?.id === id) {
        this.state.status =
          task.canceled || (!!this.token && !this.host.valid(this.token)) ? 'canceled' : 'failed';
        this.state.error =
          this.state.status === 'canceled'
            ? '识别流程已取消'
            : error instanceof Error
              ? error.message
              : '识别流程失败';
      }
      if (task.canceled || (this.token && !this.host.valid(this.token))) return false;
      throw error;
    } finally {
      if (this.task === task) this.task = undefined;
      task.finish();
    }
  }
  read(token: string, id: string): OCRWorkflowResult {
    if (
      !token ||
      token !== this.token ||
      !this.host.valid(token) ||
      id !== this.state?.id ||
      this.active ||
      !this.output
    )
      throw Error('识别流程结果已失效');
    return structuredClone(this.output);
  }
  async cancel(owner?: string) {
    const task = this.task;
    if (!task || (owner !== undefined && owner !== task.owner)) return;
    task.canceled = true;
    await this.host.cancel();
    await task.done;
  }
  closed(cancel = true) {
    if (this.task && cancel) this.task.canceled = true;
    this.state = undefined;
    this.output = undefined;
    this.token = '';
    this.owner = undefined;
  }
}
