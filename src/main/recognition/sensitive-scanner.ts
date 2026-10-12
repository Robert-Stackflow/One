import { decodePng, pngDimensions } from '../capture/clipboard';
import { OCRModels } from './ocr-models';
import { OCRRunner } from './ocr-runner';
import { ocrDimensions } from '../../shared/recognition/ocr';
import { detectSensitive } from '../../shared/recognition/sensitive-api';

export class SensitiveScanner {
  private task?: { owner: string; canceled: boolean; done: Promise<void>; finish(): void };
  private runner: OCRRunner;
  constructor(
    private models: OCRModels,
    runner?: OCRRunner,
  ) {
    this.runner = runner || new OCRRunner(models);
  }
  async run(owner: string, value: string) {
    if (!owner || this.task) throw Error('正在识别敏感文字，请先取消当前任务');
    const size = pngDimensions(value);
    ocrDimensions(size.width, size.height);
    const { data: png } = decodePng(value);
    let finish!: () => void;
    const task = (this.task = {
      owner,
      canceled: false,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    });
    try {
      if (!(await this.models.state()).ready)
        throw Error('请先在文字识别窗口下载本机语言包，再识别敏感文字');
      if (task.canceled) throw Error('敏感文字识别已取消');
      const result = await this.runner.run(png, size, 'chi_sim+eng');
      if (task.canceled) throw Error('敏感文字识别已取消');
      return detectSensitive(result);
    } finally {
      png.fill(0);
      if (this.task === task) this.task = undefined;
      task.finish();
    }
  }
  async cancel(owner?: string) {
    const task = this.task;
    if (!task || (owner !== undefined && task.owner !== owner)) return;
    task.canceled = true;
    await this.runner.cancel();
    await task.done;
  }
}
