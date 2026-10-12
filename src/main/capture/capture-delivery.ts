import { createHash } from 'node:crypto';
import { actionList, type CaptureAction, type CaptureResult } from '../../shared/capture/capture-workflow';
/** Session-local receipts survive retries. No prior acknowledged action is repeated for the same output and ordered workflow. */
export class CaptureDelivery {
  private running = false;
  private completed = new Map<string, Set<CaptureAction>>();
  async execute(
    png: Buffer,
    values: CaptureAction[],
    deliver: (action: CaptureAction) => Promise<boolean>,
    context = '',
  ): Promise<CaptureResult> {
    if (this.running) throw Error('截图正在输出');
    const actions = actionList(values);
    const key = createHash('sha256')
      .update(png)
      .update(JSON.stringify(actions))
      .update(context)
      .digest('hex');
    if (!this.completed.has(key) && this.completed.size >= 128)
      throw Error('输出变化过多，请结束当前会话后重新截图');
    const completed = this.completed.get(key) || new Set<CaptureAction>();
    this.completed.set(key, completed);
    const receipts = actions.map(
      (action) => ({ action, status: completed.has(action) ? 'completed' : 'pending' }) as const,
    );
    const result: CaptureResult = { completed: false, receipts: receipts.map((r) => ({ ...r })) };
    this.running = true;
    try {
      for (const receipt of result.receipts) {
        if (completed.has(receipt.action)) continue;
        try {
          if (!(await deliver(receipt.action))) {
            receipt.status = 'canceled';
            return result;
          }
          completed.add(receipt.action);
          receipt.status = 'completed';
        } catch (error) {
          receipt.status = 'failed';
          result.error = error instanceof Error ? error.message : String(error);
          return result;
        }
      }
      result.completed = true;
      return result;
    } finally {
      this.running = false;
    }
  }
}
