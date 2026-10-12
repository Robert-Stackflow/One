import { app, screen } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { limitChildProcess } from '../capture/native';
import { t } from '../../shared/capture/i18n';
import { sourcePreviews, type SourcePreview } from './recording-sources-protocol';
interface Job {
  valid: () => boolean;
  cancelled: boolean;
  child?: ChildProcess;
  stopped: Promise<void>;
  release: () => void;
  deadline: number;
}
/** Native preview jobs hold at most one bounded bitmap outside Electron. */
export class RecordingSources {
  private jobs = new Set<Job>();
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private timeout = 12000,
    private executable = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked/dist/native/One.RecordingSources.exe')
      : join(__dirname, '../native/One.RecordingSources.exe'),
  ) {}
  stats() {
    return {
      jobs: this.jobs.size,
      processes: [...this.jobs].filter((job) => !!job.child?.pid).map((job) => job.child!.pid!),
    };
  }
  private cancel(job: Job) {
    job.cancelled = true;
    job.child?.kill();
  }
  async stop() {
    const jobs = [...this.jobs];
    jobs.forEach((job) => this.cancel(job));
    await Promise.all(jobs.map((job) => job.stopped));
  }
  run(type: 'screen' | 'window', valid: () => boolean): Promise<SourcePreview[]> {
    for (const previous of this.jobs) this.cancel(previous);
    let release!: () => void;
    const job: Job = {
      valid,
      cancelled: false,
      stopped: new Promise<void>((r) => (release = r)),
      release: () => release(),
      deadline: Date.now() + this.timeout,
    };
    this.jobs.add(job);
    const result = this.serial
      .then(() => this.execute(job, type))
      .finally(() => {
        this.jobs.delete(job);
        job.release();
      });
    this.serial = result.catch(() => {});
    return result;
  }
  private live(job: Job) {
    return !job.cancelled && job.valid();
  }
  private async execute(job: Job, type: 'screen' | 'window') {
    if (!this.live(job)) throw new Error(t('录制已取消'));
    const data = JSON.parse(
      (
        await this.command(
          job,
          [type === 'window' ? 'windows' : 'screens'],
          Math.min(3000, this.timeout),
          1024 * 1024,
        )
      ).toString('utf8'),
    );
    if (!Array.isArray(data) || data.length > 150) throw new Error(t('录制来源已失效'));
    const displays = screen
      .getAllDisplays()
      .map((display) => ({ display, physical: screen.dipToScreenRect(null, display.bounds) }));
    const sources: { source: SourcePreview; target: string }[] = [];
    for (const row of data) {
      if (type === 'window') {
        if (
          !row ||
          typeof row.pid !== 'number' ||
          !Number.isSafeInteger(row.pid) ||
          row.pid === process.pid
        )
          continue;
        sources.push({ source: sourcePreviews([row], type)[0], target: row.id.split(':')[1] });
      } else {
        if (
          !row ||
          typeof row.device !== 'string' ||
          !/^\\\\\.\\DISPLAY\d+$/.test(row.device) ||
          !/^screen:\d+:0$/.test(row.id)
        )
          throw new Error(t('录制来源已失效'));
        // Electron rounds physical sizes into DIP, then dipToScreenRect rounds back.
        // Mixed-DPI monitors can therefore differ by 1-2 pixels, without moving.
        const matches = displays.filter(
          ({ display, physical: p }) =>
            p.x === row.x &&
            p.y === row.y &&
            Math.abs(p.width - row.width) <= Math.ceil(display.scaleFactor) &&
            Math.abs(p.height - row.height) <= Math.ceil(display.scaleFactor),
        );
        if (matches.length !== 1) continue;
        const match = matches[0];
        sources.push({
          source: {
            id: row.id,
            name: match.display.label || t`显示器 ${displays.indexOf(match) + 1}`,
            display_id: String(match.display.id),
            thumbnail: 'data:image/png;base64,',
          },
          target: row.device,
        });
      }
    }
    if (
      type === 'screen' &&
      (sources.length !== displays.length ||
        new Set(sources.map((item) => item.source.display_id)).size !== displays.length)
    )
      throw new Error(t('显示器配置已改变，请重新选择'));
    if (type === 'screen') {
      const primary = String(screen.getPrimaryDisplay().id);
      sources.sort(
        (a, b) => Number(b.source.display_id === primary) - Number(a.source.display_id === primary),
      );
    }
    for (const item of sources) {
      if (!this.live(job)) throw new Error(t('录制已取消'));
      if (Date.now() >= job.deadline) break;
      // A hung/protected/oversized window loses only its preview, not the catalog.
      try {
        const image = await this.command(
          job,
          [type, item.target, ...(type === 'window' ? [String(item.source.pid)] : [])],
          Math.min(700, job.deadline - Date.now()),
          256 * 1024,
        );
        if (
          image.length > 8 &&
          image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          item.source.thumbnail = 'data:image/png;base64,' + image.toString('base64');
      } catch {
        if (!this.live(job)) throw new Error(t('录制已取消'));
      }
    }
    if (!this.live(job)) throw new Error(t('录制已取消'));
    return sourcePreviews(
      sources.map((item) => item.source),
      type,
    );
  }
  private command(job: Job, args: string[], timeout: number, maximum: number): Promise<Buffer> {
    return new Promise((accept, reject) => {
      if (!this.live(job)) {
        reject(new Error(t('录制已取消')));
        return;
      }
      let error: Error | undefined,
        closeJob: (() => void) | undefined,
        size = 0;
      const chunks: Buffer[] = [];
      const child = spawn(this.executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { SystemRoot: process.env.SystemRoot },
      });
      job.child = child;
      const monitor = setInterval(() => {
          if (!this.live(job)) {
            error = new Error(t('录制已取消'));
            child.kill();
          }
        }, 20),
        timer = setTimeout(
          () => {
            error = new Error(t('未能取得录制来源，请重试'));
            child.kill();
          },
          Math.max(1, timeout),
        );
      monitor.unref();
      timer.unref();
      child.once('spawn', () => {
        try {
          closeJob = limitChildProcess(child.pid!, 128);
          if (!this.live(job)) child.kill();
        } catch (e) {
          error = e as Error;
          child.kill();
        }
      });
      child.stdout!.on('data', (bytes: Buffer) => {
        size += bytes.length;
        if (size > maximum) {
          error = new Error(t('录制来源已失效'));
          child.kill();
        } else chunks.push(bytes);
      });
      child.once('error', (e) => (error = e));
      child.once('close', (code) => {
        clearInterval(monitor);
        clearTimeout(timer);
        closeJob?.();
        job.child = undefined;
        if (error || code !== 0 || !this.live(job))
          reject(error || new Error(t(this.live(job) ? '未能取得录制来源，请重试' : '录制已取消')));
        else accept(Buffer.concat(chunks));
      });
    });
  }
}
