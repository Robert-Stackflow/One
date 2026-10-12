import { dialog, type BrowserWindow } from 'electron';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { recordingProject, type RecordingProject } from '../../shared/recording/recording-project';
import {
  recordingExportOptions,
  recordingExportPlan,
  gifPreviewPlan,
  gifEstimatedBytes,
  type GifPreview,
  type RecordingExportPlan,
  type RecordingExportPayload,
  type RecordingExportState,
} from '../../shared/recording/recording-export';
import {
  RecordingEncoder,
  checkRecordingEncoder,
  resolveRecordingEncoder,
  type ExportAudioFile,
} from './recording-encoder';
import type { RecordingFile } from './recording-file';
import { markExportScratch, cleanExportScratchDirectory } from './recording-export-cleanup';
import { RECORD_BYTES } from '../../shared/recording/recording';

import { recordingWindowURL, type RecordingWindowHost } from './window-host';
const URL = recordingWindowURL('recording-export');
interface ExportSnapshot {
  project: RecordingProject;
  video: string;
  camera?: string;
  audio: { kind: ExportAudioFile['kind']; file: RecordingFile; extension: string }[];
}
interface Job {
  abort: AbortController;
  id: string;
  token: string;
  cancelled: boolean;
  snapshot: ExportSnapshot;
  payload?: RecordingExportPayload;
  window?: BrowserWindow;
  encoder?: RecordingEncoder;
  task?: Promise<void>;
  release?: () => void;
  reject?: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  ending?: boolean;
  preview?: RecordingExportPlan;
  previewResult?: GifPreview;
}
export class RecordingExport {
  state?: RecordingExportState;
  private job?: Job;
  private lastChanged = 0;
  get busy() {
    return !!this.job;
  }
  constructor(
    private host: RecordingWindowHost,
    private directory: string,
    private actions: {
      snapshot(): ExportSnapshot;
      token(): string;
      allowed(): boolean;
      changed(): void;
      protect(file: string): void;
    },
  ) {
    const handle = (name: string, fn: (job: Job, ...args: any[]) => unknown) =>
      host.register('recording-export-' + name, (event, ...args) => {
        const job = this.job,
          window = job?.window;
        if (
          !job ||
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== URL ||
          !this.valid(job) ||
          (name !== 'payload' && args[0] !== job.id)
        )
          throw Error('合成工作区已失效');
        this.watch(job);
        return fn(job, ...(name === 'payload' ? args : args.slice(1)));
      }, ['recording-export']);
    handle('payload', (job) => job.payload);
    handle('frame', async (job, index, bytes) => {
      await job.encoder!.frame(index, bytes);
      if (!this.valid(job)) throw Error('合成导出已取消');
      this.update(job, {
        phase: 'rendering',
        frames: index + 1,
        progress: (0.9 * (index + 1)) / job.payload!.plan.frames,
      });
    });
    handle('finish', async (job) => {
      if (job.ending) throw Error('合成导出已结束');
      job.ending = true;
      this.update(job, { phase: 'encoding', progress: 0.95, message: '正在完成编码…' });
      try {
        const path = await job.encoder!.finish(() => this.valid(job));
        if (job.preview) {
          const bytes = new Uint8Array(await readFile(path));
          if (!this.valid(job)) throw Error('合成预览已取消');
          job.previewResult = {
            bytes,
            width: job.preview.width,
            height: job.preview.height,
            colors: job.preview.colors,
            sampleFrames: job.payload!.plan.frames,
            totalFrames: job.preview.frames,
            seconds: job.preview.seconds,
            estimatedBytes: gifEstimatedBytes(
              bytes.length,
              job.payload!.plan.frames,
              job.preview.frames,
              job.preview.repeat!,
            ),
            complete: job.payload!.plan.frames === job.preview.frames,
            optimized: job.preview.gifOutput?.optimize || false,
          };
          this.update(job, { phase: 'previewed', progress: 1, message: 'GIF 编码预览已就绪' });
          job.release?.();
          return;
        }
        this.update(job, {
          phase: 'saved',
          progress: 1,
          path,
          bytes: job.encoder!.bytes,
          message: '合成导出已保存',
        });
        job.release?.();
      } catch (error) {
        job.reject?.(error as Error);
        throw error;
      }
    });
    handle('fail', (job, message) => {
      job.reject?.(Error(typeof message === 'string' ? message.slice(0, 512) : '合成失败，请重试'));
    });
  }
  private valid(job: Job) {
    return (
      this.job === job &&
      !job.cancelled &&
      this.actions.allowed() &&
      this.actions.token() === job.token
    );
  }
  private watch(job: Job) {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      job.reject?.(Error('合成工作区响应超时，请重试。原片仍已保留。'));
      void job.encoder?.cancel();
    }, 60000);
  }
  private update(job: Job, patch: Partial<RecordingExportState>) {
    if (this.job !== job || !this.state) return;
    const previousPhase = this.state.phase;
    this.state = { ...this.state, ...patch };
    if (
      previousPhase === this.state.phase &&
      this.state.phase === 'rendering' &&
      Date.now() - this.lastChanged < 100
    )
      return;
    this.lastChanged = Date.now();
    this.actions.changed();
  }
  async start(value: unknown, owner: BrowserWindow) {
    return (await this.begin(value, owner, false))?.id || null;
  }
  async preview(value: unknown, complete: unknown = false): Promise<GifPreview | null> {
    if (typeof complete !== 'boolean') throw Error('GIF 预览模式无效');
    const job = await this.begin(value, undefined, complete ? 'full' : 'sample');
    if (!job) return null;
    await job.task;
    if (job.cancelled) return null;
    if (!job.previewResult) throw Error(this.state?.message || 'GIF 编码预览失败');
    return job.previewResult;
  }
  private async begin(
    value: unknown,
    owner: BrowserWindow | undefined,
    preview: 'full' | 'sample' | false,
  ) {
    if (this.job || !this.actions.allowed()) throw Error('请先完成当前录制或导出');
    const options = recordingExportOptions(value),
      snapshot = this.actions.snapshot();
    snapshot.project = recordingProject(snapshot.project);
    const fullPlan = recordingExportPlan(snapshot.project, options),
      plan = preview ? gifPreviewPlan(fullPlan, preview === 'full') : fullPlan,
      id = randomUUID(),
      job: Job = {
        id,
        token: this.actions.token(),
        cancelled: false,
        snapshot,
        abort: new AbortController(),
        ...(preview ? { preview: fullPlan } : {}),
      };
    this.job = job;
    this.state = {
      busy: true,
      id,
      phase: 'preparing',
      progress: 0,
      frames: 0,
      total: plan.frames,
      message: preview ? '正在准备 GIF 编码预览…' : '正在准备合成…',
    };
    this.actions.changed();
    try {
      const executable = plan.timeline
        ? ''
        : await resolveRecordingEncoder(join(__dirname, '../native'));
      if (!this.valid(job)) return null;
      if (!plan.timeline) await checkRecordingEncoder(executable, options.format, job.abort.signal);
      if (!this.valid(job)) return null;
      const chosen = preview
        ? { canceled: false, filePath: '' }
        : await dialog.showSaveDialog(owner!, {
            title: '合成导出',
            defaultPath: 'One-合成.' + options.format,
            filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }],
          });
      if (chosen.canceled || (!preview && !chosen.filePath) || !this.valid(job)) {
        this.update(job, { phase: 'cancelled', message: '合成导出已取消' });
        return null;
      }
      const destination = preview
        ? ''
        : extname(chosen.filePath).toLowerCase() === '.' + options.format
          ? chosen.filePath
          : chosen.filePath + '.' + options.format;
      if (!preview) this.actions.protect(destination);
      job.payload = {
        id,
        project: snapshot.project,
        plan,
        video: snapshot.video,
        camera: snapshot.camera,
      };
      job.task = this.run(job, executable, destination);
      void job.task.catch(() => {});
      return job;
    } catch (error) {
      this.update(job, {
        phase: job.cancelled ? 'cancelled' : 'failed',
        message: job.cancelled ? '合成导出已取消' : (error as Error).message,
      });
      if (job.cancelled) return null;
      throw error;
    } finally {
      if (!job.task && this.job === job) {
        this.job = undefined;
        this.state = { ...this.state!, busy: false };
        clearTimeout(job.timer);
        this.actions.changed();
      }
    }
  }
  private async run(job: Job, executable: string, destination: string) {
    let scratch = '';
    try {
      await mkdir(this.directory, { recursive: true });
      scratch = await mkdtemp(join(this.directory, 'compose-'));
      if (job.preview) destination = join(scratch, 'preview.gif');
      await markExportScratch(scratch, job.id, destination);
      const audio: ExportAudioFile[] = [];
      if (job.payload!.plan.format === 'mp4')
        for (const source of job.snapshot.audio) {
          if (!this.valid(job)) throw Error('合成导出已取消');
          const path = join(scratch, source.kind + '.' + source.extension);
          await source.file.export(path, () => this.valid(job));
          audio.push({ kind: source.kind, path });
        }
      if (!this.valid(job)) throw Error('合成导出已取消');
      if (!job.preview) this.actions.protect(destination);
      job.encoder = await RecordingEncoder.create(
        executable,
        job.payload!.plan,
        destination,
        job.snapshot.project.playback,
        audio,
        () => this.watch(job),
        job.id,
        undefined,
        job.preview ? 64 * 1024 * 1024 : RECORD_BYTES,
      );
      if (!this.valid(job)) throw Error('合成导出已取消');
      const completed = new Promise<void>((accept, reject) => {
        job.release = accept;
        job.reject = reject;
      });
      void completed.catch(() => {});
      this.watch(job);
      const window = this.host.createWindow('recording-export', {
        show: false,
        width: 64,
        height: 64,
        skipTaskbar: true,
      });
      job.window = window;
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.webContents.on('render-process-gone', () =>
        job.reject?.(Error('合成工作区意外退出，请重试。原片仍已保留。')),
      );
      window.once('closed', () => {
        if (!job.ending) job.reject?.(Error('合成工作区已关闭，请重试'));
      });
      await window.loadURL(URL);
      await completed;
    } catch (error) {
      this.update(job, {
        phase: job.cancelled ? 'cancelled' : 'failed',
        message: job.cancelled ? '合成导出已取消' : (error as Error).message,
      });
    } finally {
      clearTimeout(job.timer);
      job.ending = true;
      if (job.window && !job.window.isDestroyed()) job.window.destroy();
      await job.encoder?.cancel();
      try {
        if (scratch) {
          if (!(await cleanExportScratchDirectory(this.directory, scratch, job.id)))
            throw Error('合成临时目录归属检查失败');
        }
      } catch (error) {
        console.warn(
          'One composition scratch cleanup failed:',
          scratch,
          (error as Error).message,
        );
        this.update(job, { message: (this.state?.message || '') + '；合成临时数据未能清理' });
      } finally {
        if (this.job === job) {
          this.job = undefined;
          this.state = { ...this.state!, busy: false };
          this.actions.changed();
        }
      }
    }
  }
  async cancel(value: unknown) {
    const job = this.job;
    if (typeof value !== 'string' || !job || value !== job.id) throw Error('合成任务已失效');
    if (['saved', 'previewed'].includes(this.state?.phase || '')) {
      await job.task;
      return;
    }
    job.cancelled = true;
    job.abort.abort();
    job.reject?.(Error('合成导出已取消'));
    this.update(job, { phase: 'cancelled', message: '正在取消合成…' });
    await job.encoder?.cancel();
    await job.task;
    this.update(job, { message: '合成导出已取消' });
  }
  async reset() {
    const job = this.job;
    if (job) await this.cancel(job.id);
    if (this.job === job) this.job = undefined;
    this.state = undefined;
  }
}
