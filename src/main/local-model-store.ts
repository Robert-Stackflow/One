import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { LocalModelArtifact, LocalModelDescriptor, LocalModelProgress, LocalModelState } from '../shared/local-models';

// The app has one main process. Locks also cover different store instances sharing its data directory.
const operations = new Map<string, 'install' | 'delete'>();
const leases = new Map<string, number>();
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
async function info(path: string) { try { return await lstat(path); } catch (error) { if (absent(error)) return; throw error; } }
async function directory(path: string, create = false) {
  if (create) await mkdir(path, { recursive: true });
  const value = await info(path);
  if (value && (!value.isDirectory() || value.isSymbolicLink())) throw Error('模型缓存目录无效');
  return !!value;
}
async function fileBytes(path: string, limit: number) {
  const value = await info(path);
  if (!value) return 0;
  if (!value.isFile() || value.isSymbolicLink() || value.size > limit) throw Error('模型缓存文件无效，请删除后重试');
  return value.size;
}
async function verified(path: string, artifact: LocalModelArtifact, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (await fileBytes(path, artifact.bytes) !== artifact.bytes) return false;
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) { signal?.throwIfAborted(); hash.update(bytes); }
  return hash.digest('hex') === artifact.sha256;
}

export function localModelIdentity(input: LocalModelDescriptor) {
  if (!input || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.id) || !/^[a-zA-Z0-9._+-]{1,120}$/.test(input.revision) ||
      !Array.isArray(input.artifacts) || !input.artifacts.length || input.artifacts.length > 32) throw Error('模型描述无效');
  const names = new Set<string>(), roles = new Set<string>();
  for (const artifact of input.artifacts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(artifact.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(artifact.name) ||
        artifact.name.endsWith('.') || artifact.name.endsWith('.part') || names.has(artifact.name.toLowerCase()) ||
        !/^[a-zA-Z][a-zA-Z0-9-]{0,50}$/.test(artifact.role) || roles.has(artifact.role) ||
        !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 8 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('模型文件描述无效');
    let url: URL;
    try { url = new URL(artifact.url); } catch { throw Error('模型下载地址无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('模型下载地址无效');
    names.add(artifact.name.toLowerCase()); roles.add(artifact.role);
  }
  const hash = createHash('sha256').update(JSON.stringify([input.id, input.revision,
    input.artifacts.map(({ name, role, url, bytes, sha256 }) => [name, role, url, bytes, sha256])])).digest('hex');
  return input.id + '-' + hash.slice(0, 24);
}

/** Fixed-hash bundle cache. A directory becomes visible only when every artifact is verified. */
export class LocalModelStore {
  readonly root: string;
  constructor(root: string, private transport: typeof fetch = fetch, private idleTimeoutMs = 25000) { this.root = resolve(root); }
  private paths(model: LocalModelDescriptor) {
    const key = localModelIdentity(model);
    const installed = join(this.root, key);
    return { installed, stage: join(this.root, key + '.partial'), lock: process.platform === 'win32' ? installed.toLowerCase() : installed };
  }
  async state(model: LocalModelDescriptor, signal?: AbortSignal, verifyIntegrity = true): Promise<LocalModelState> {
    const paths = this.paths(model), totalBytes = model.artifacts.reduce((sum, a) => sum + a.bytes, 0);
    const rootExists = await directory(this.root);
    let installedBytes = 0, downloadedBytes = 0, ready = false;
    if (rootExists) {
      if (await directory(paths.installed)) {
        ready = true;
        for (const artifact of model.artifacts) {
          const bytes = await fileBytes(join(paths.installed, artifact.name), artifact.bytes); installedBytes += bytes;
          if (bytes !== artifact.bytes || verifyIntegrity && !await verified(join(paths.installed, artifact.name), artifact, signal)) ready = false;
        }
      }
      if (await directory(paths.stage)) for (const artifact of model.artifacts)
        downloadedBytes += await fileBytes(join(paths.stage, artifact.name), artifact.bytes) + await fileBytes(join(paths.stage, artifact.name + '.part'), artifact.bytes);
    }
    return { ready, downloadedBytes: ready ? totalBytes : downloadedBytes, diskBytes: installedBytes + downloadedBytes,
      totalBytes, downloading: operations.get(paths.lock) === 'install', inUse: !!leases.get(paths.lock) };
  }
  async install(input: LocalModelDescriptor, signal: AbortSignal, progress: (value: LocalModelProgress) => void = () => {}, localSources: Readonly<Record<string, string>> = {}) {
    const model = structuredClone(input), paths = this.paths(model), sources = { ...localSources };
    if (operations.has(paths.lock)) throw Error('模型正在下载或删除，请稍后重试');
    operations.set(paths.lock, 'install');
    const total = model.artifacts.reduce((sum, a) => sum + a.bytes, 0);
    let completed = 0;
    try {
      signal.throwIfAborted();
      await directory(this.root, true);
      progress({ phase: 'checking', received: 0, total });
      if ((await this.state(model, signal)).ready) { progress({ phase: 'ready', received: total, total }); return paths.installed; }
      if (leases.get(paths.lock)) throw Error('模型正在使用，无法替换');
      await directory(paths.stage, true);
      for (const artifact of model.artifacts) {
        signal.throwIfAborted();
        const target = join(paths.stage, artifact.name), partial = target + '.part';
        if (!await verified(target, artifact, signal)) {
          await rm(target, { force: true });
          // Import existing user caches offline. Recheck the copied bytes, since the source may change during copying.
          const source = sources[artifact.role];
          let canImport = false;
          if (source) { try { canImport = await verified(source, artifact, signal); } catch { signal.throwIfAborted(); } }
          if (canImport) {
            await fileBytes(partial, artifact.bytes);
            await copyFile(source, partial);
          } else await this.download(artifact, partial, signal, received => progress({ phase: 'downloading', received: completed + received, total, artifact: artifact.role }));
          progress({ phase: 'verifying', received: completed + artifact.bytes, total, artifact: artifact.role });
          if (!await verified(partial, artifact, signal)) { await rm(partial, { force: true }); throw Error('模型 SHA-256 校验失败，请重试下载'); }
          signal.throwIfAborted();
          await rename(partial, target);
        } else await rm(partial, { force: true });
        completed += artifact.bytes;
      }
      signal.throwIfAborted();
      // An existing invalid bundle has no active readers and is removed only after its replacement is complete.
      if (await directory(paths.installed)) await rm(paths.installed, { recursive: true });
      await rename(paths.stage, paths.installed);
      progress({ phase: 'ready', received: total, total });
      return paths.installed;
    } finally { operations.delete(paths.lock); }
  }
  private async download(artifact: LocalModelArtifact, partial: string, signal: AbortSignal, progress: (received: number) => void) {
    let received = await fileBytes(partial, artifact.bytes);
    if (received === artifact.bytes) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; cancel(); }, this.idleTimeoutMs); timer.unref(); };
    signal.addEventListener('abort', cancel, { once: true });
    reset();
    try {
      signal.throwIfAborted();
      const response = await this.transport(artifact.url, { signal: controller.signal, credentials: 'omit', redirect: 'follow',
        headers: { 'Accept-Encoding': 'identity', ...(received ? { Range: `bytes=${received}-` } : {}) } });
      if (!response.ok || !response.body) throw Error(`模型下载失败：HTTP ${response.status}`);
      reader = response.body.getReader();
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') throw Error('模型服务器返回了不支持的压缩响应');
      if (response.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!match || Number(match[1]) !== received || Number(match[2]) !== artifact.bytes - 1 || Number(match[3]) !== artifact.bytes) throw Error('模型断点响应范围不符');
      } else if (response.status === 200) received = 0; // A server without ranges can still restart safely.
      else throw Error('模型下载响应无效');
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== artifact.bytes - received) throw Error('模型下载大小不符');
      // Validate before opening: a malformed range must never truncate a usable partial file.
      const file = await open(partial, received ? 'r+' : 'w');
      try {
        progress(received); reset();
        while (true) {
          signal.throwIfAborted();
          if (timedOut) throw Error('模型下载连接超时，已保留下载进度');
          const next = await reader.read();
          if (next.done) break;
          const bytes = next.value;
          if (received + bytes.length > artifact.bytes) throw Error('模型下载大小超过预期');
          let at = 0;
          while (at < bytes.length) {
            const result = await file.write(bytes, at, bytes.length - at, received + at);
            if (!result.bytesWritten) throw Error('模型文件写入失败');
            at += result.bytesWritten;
          }
          received += bytes.length; progress(received); reset();
        }
        signal.throwIfAborted();
        if (timedOut) throw Error('模型下载连接超时，已保留下载进度');
        if (received !== artifact.bytes) throw Error('模型下载中断，已保留下载进度');
        await file.sync();
      } finally { await file.close(); }
    } catch (error) {
      if (signal.aborted) throw Error('模型下载已取消，已保留下载进度');
      if (timedOut) throw Error('模型下载连接超时，已保留下载进度');
      throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
    }
  }
  /** Keep model files alive for an inference task, including while the user's selection changes. */
  async acquire(input: LocalModelDescriptor) {
    const model = structuredClone(input), paths = this.paths(model);
    if (operations.has(paths.lock)) throw Error('模型正在下载或删除');
    leases.set(paths.lock, (leases.get(paths.lock) || 0) + 1);
    let released = false;
    const release = () => { if (!released) { released = true; const count = (leases.get(paths.lock) || 1) - 1; if (count) leases.set(paths.lock, count); else leases.delete(paths.lock); } };
    try {
      if (!(await this.state(model)).ready) throw Error('模型缺失或校验失败，请下载或修复模型');
      return { model, files: model.artifacts.map(artifact => ({ ...artifact, path: join(paths.installed, artifact.name) })), release };
    } catch (error) { release(); throw error; }
  }
  async remove(model: LocalModelDescriptor) {
    const paths = this.paths(model);
    if (operations.has(paths.lock) || leases.get(paths.lock)) throw Error('模型正在下载或使用，请完成或取消任务后删除');
    operations.set(paths.lock, 'delete');
    try {
      if (!await directory(this.root)) return;
      for (const path of [paths.installed, paths.stage]) if (await directory(path)) await rm(path, { recursive: true });
    } finally { operations.delete(paths.lock); }
  }
}
