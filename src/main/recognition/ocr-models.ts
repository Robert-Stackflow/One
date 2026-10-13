import {serviceRequest} from '../service-request';
import { mkdir, readFile, lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { OCRLanguage } from '../../shared/recognition/ocr';
export const ocrPacks = [
  {
    id: 'eng',
    bytes: 4113088,
    sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  },
  {
    id: 'chi_sim',
    bytes: 2469156,
    sha256: 'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730',
  },
] as const;
const modelRoot =
  'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/';
export class OCRModels {
  private preparing = 0;
  downloading = false;
  progress = 0;
  error = '';
  private abort?: AbortController;
  private active?: Promise<void>;
  constructor(
    readonly directory: string,
    private transport: typeof fetch = serviceRequest,
  ) {}
  private path(id: string) {
    return join(this.directory, id + '.traineddata');
  }
  private async read(pack: (typeof ocrPacks)[number]) {
    const path = this.path(pack.id),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pack.bytes)
      throw Error('识别语言包缺失或无效，请下载语言包');
    const data = await readFile(path);
    if (
      data.length !== pack.bytes ||
      createHash('sha256').update(data).digest('hex') !== pack.sha256
    ) {
      data.fill(0);
      throw Error('识别语言包校验失败，请重新下载');
    }
    return data;
  }
  async state() {
    const parts = await Promise.all(
        ocrPacks.map(async (pack) => {
          try {
            const s = await lstat(this.path(pack.id));
            return { ready: s.isFile() && !s.isSymbolicLink() && s.size === pack.bytes, bytes: s.isFile() && !s.isSymbolicLink() ? s.size : 0 };
          } catch {
            return { ready: false, bytes: 0 };
          }
        }),
      );
    return { ready: parts.every(part => part.ready), diskBytes: parts.reduce((sum, part) => sum + part.bytes, 0), downloading: this.downloading, progress: this.progress, error: this.error };
  }
  async prepare(language: OCRLanguage) {
    this.preparing++;
    const result: { code: string; data: Uint8Array }[] = [];
    try {
      if (this.downloading) throw Error('正在下载识别语言包');
      const root = await lstat(this.directory);
      if (!root.isDirectory() || root.isSymbolicLink()) throw Error('识别语言包目录无效');
      for (const pack of ocrPacks.filter((p) => language !== 'eng' || p.id === 'eng'))
        result.push({ code: pack.id, data: await this.read(pack) });
      return result;
    } catch (error) {
      for (const p of result) p.data.fill(0);
      this.error = '识别语言包缺失或无效，请重新下载语言包';
      throw Error(this.error);
    } finally { this.preparing--; }
  }
  async remove() {
    if (this.downloading || this.preparing) throw Error('语言包正在下载或使用');
    const root = await lstat(this.directory).catch(error => { if (error.code === 'ENOENT') return; throw error; });
    if (root && (!root.isDirectory() || root.isSymbolicLink())) throw Error('识别语言包目录无效');
    for (const pack of ocrPacks) await unlink(this.path(pack.id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    this.error = ''; this.progress = 0;
  }
  cancel() {
    this.abort?.abort();
  }
  async settle() {
    this.cancel();
    await this.active?.catch(() => {});
  }
  install() {
    if (this.active) return Promise.reject(Error('正在下载识别语言包'));
    const task = this.download();
    const active = task.finally(() => {
      if (this.active === active) this.active = undefined;
    });
    this.active = active;
    return active;
  }
  private async download() {
    this.downloading = true;
    this.progress = 0;
    this.error = '';
    const abort = (this.abort = new AbortController());
    const timer = setTimeout(() => abort.abort(), 120000);
    timer.unref();
    try {
      await mkdir(this.directory, { recursive: true });
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error('识别语言包目录无效');
      const total = ocrPacks.reduce((n, p) => n + p.bytes, 0);
      let done = 0;
      for (const pack of ocrPacks) {
        abort.signal.throwIfAborted();
        let existing: Buffer | undefined;
        try {
          existing = await this.read(pack);
        } catch {}
        if (existing) {
          existing.fill(0);
          done += pack.bytes;
          this.progress = done / total;
          continue;
        }
        const partial = join(this.directory, '.' + randomUUID() + '.part');
        let file: Awaited<ReturnType<typeof open>> | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const response = await this.transport(modelRoot + pack.id + '.traineddata', {
            signal: abort.signal,
            redirect: 'error',
            credentials: 'omit',
          });
          reader = response.body?.getReader();
          if (!response.ok || !reader) throw Error('语言包下载失败，请检查网络后重试');
          const declared = response.headers.get('content-length');
          if (declared !== null && Number(declared) !== pack.bytes)
            throw Error('语言包下载大小不符');
          file = await open(partial, 'wx');
          const hash = createHash('sha256');
          let bytes = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            const chunk = next.value;
            abort.signal.throwIfAborted();
            bytes += chunk.length;
            if (bytes > pack.bytes) throw Error('语言包下载大小不符');
            hash.update(chunk);
            let at = 0;
            while (at < chunk.length) {
              const written = await file.write(chunk, at, chunk.length - at);
              if (!written.bytesWritten) throw Error('语言包写入失败');
              at += written.bytesWritten;
            }
            this.progress = (done + bytes) / total;
          }
          if (bytes !== pack.bytes || hash.digest('hex') !== pack.sha256)
            throw Error('识别语言包校验失败，请重试');
          await file.sync();
          await file.close();
          file = undefined;
          abort.signal.throwIfAborted();
          await rename(partial, this.path(pack.id));
          done += pack.bytes;
        } finally {
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
          await file?.close().catch(() => {});
          await unlink(partial).catch(() => {});
        }
      }
    } catch (error) {
      this.error = abort.signal.aborted
        ? '语言包下载已取消'
        : error instanceof Error
          ? error.message
          : '语言包下载失败';
      throw Error(this.error);
    } finally {
      clearTimeout(timer);
      if (this.abort === abort) this.abort = undefined;
      this.downloading = false;
    }
  }
}
