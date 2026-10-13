export interface LocalInferenceClient {
  readonly owner: symbol;
  /** Release a retained native model before another client starts. */
  unload?(): Promise<void>;
}
interface Job {
  client: LocalInferenceClient;
  signal: AbortSignal;
  execute(): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cancel(): void;
}
const cancelled = () => Error('本地推理任务已取消');

/** Main-process admission for local native inference, including retained model caches. */
export class LocalInferenceScheduler {
  private queue: Job[] = [];
  private active?: Job;
  private resident?: LocalInferenceClient;
  private pumping = false;
  constructor(private readonly capacity = 8) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) throw Error('本地推理队列容量无效');
  }
  get pending() { return this.queue.length; }
  get running() { return !!this.active; }
  waiting(client: LocalInferenceClient) { return this.queue.some(job => job.client.owner === client.owner); }
  run<T>(client: LocalInferenceClient, signal: AbortSignal, execute: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(cancelled());
    if (this.queue.length >= this.capacity) return Promise.reject(Error('本地推理队列已满，请稍后重试'));
    return new Promise<T>((resolve, reject) => {
      const job: Job = { client, signal, execute, resolve: value => resolve(value as T), reject, cancel: () => {
        const index = this.queue.indexOf(job);
        if (index < 0) return; // Active work owns cancellation and must finish native cleanup before admission changes.
        this.queue.splice(index, 1); signal.removeEventListener('abort', job.cancel); reject(cancelled());
      } };
      this.queue.push(job); signal.addEventListener('abort', job.cancel, { once: true });
      void this.pump();
    });
  }
  /** Call only after the client's native resources have been released. */
  forget(client: LocalInferenceClient) {
    if (this.resident?.owner === client.owner && this.active?.client.owner !== client.owner) this.resident = undefined;
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!; this.active = job;
        job.signal.removeEventListener('abort', job.cancel);
        try {
          if (job.signal.aborted) throw cancelled();
          if (this.resident && this.resident.owner !== job.client.owner) {
            await this.resident.unload!(); this.resident = undefined;
          }
          if (job.signal.aborted) throw cancelled();
          if (job.client.unload) this.resident = job.client;
          const value = await job.execute();
          this.active = undefined; job.resolve(value);
        } catch (error) { this.active = undefined; job.reject(error); }
      }
    } finally { this.pumping = false; }
  }
}

export const localInference = new LocalInferenceScheduler();
