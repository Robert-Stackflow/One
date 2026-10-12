import { RECORDING_PROJECT_FORMAT } from '../../shared/media-project';
import { createHash, randomUUID } from 'node:crypto';
import { open, unlink, statfs, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { RecordingFile } from './recording-file';
import { commitRecording } from '../media-file';
import {
  RECORD_BYTES,
  RECORD_CHUNK,
  recordingContentType,
  recordingRange,
} from '../../shared/recording/recording';
import type { RecordingAudioSource } from '../../shared/recording/recording';
import { validateAudioSource } from './recording-audio';
import {
  recordingProject,
  PROJECT_METADATA_BYTES,
  type RecordingProject,
} from '../../shared/recording/recording-project';

const MAGIC = Buffer.from(RECORDING_PROJECT_FORMAT.magic);
export type RecordingProjectKind = 'screen' | 'camera' | RecordingAudioSource;
type Kind = RecordingProjectKind;
interface Asset {
  kind: Kind;
  bytes: number;
  sha256: string;
}
interface Manifest {
  project: RecordingProject;
  assets: Asset[];
}
const cancelled = (valid: () => boolean) => {
  if (!valid()) throw Error('录制工程操作已取消');
};
async function write(handle: FileHandle, data: Buffer, position: number) {
  let offset = 0;
  while (offset < data.length) {
    const result = await handle.write(data, offset, data.length - offset, position + offset);
    if (!result.bytesWritten) throw Error('无法写入录制工程');
    offset += result.bytesWritten;
  }
}
async function read(handle: FileHandle, size: number, position: number) {
  const data = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(data, offset, size - offset, position + offset);
    if (!result.bytesRead) throw Error('录制工程不完整');
    offset += result.bytesRead;
  }
  return data;
}
/** Stream originals into one atomic project file; do not materialize the recordings in memory. */
export async function saveRecordingProject(
  path: string,
  value: RecordingProject,
  media: { kind: Kind; file: RecordingFile }[],
  valid: () => boolean,
) {
  const project = recordingProject(value),
    assets = media.map(({ kind, file }) => ({ kind, bytes: file.bytes, sha256: '0'.repeat(64) })),
    manifest: Manifest = { project, assets };
  validateAssets(manifest);
  const initial = Buffer.from(JSON.stringify(manifest));
  if (initial.length > PROJECT_METADATA_BYTES) throw Error('录制工程时间轴过大');
  const total = 12 + initial.length + assets.reduce((n, asset) => n + asset.bytes, 0),
    space = await statfs(dirname(path));
  if (space.bavail * space.bsize < total + 16 * 1024 * 1024)
    throw Error('磁盘空间不足，无法保存录制工程');
  cancelled(valid);
  const stage = join(dirname(path), '.One-recording-project-' + randomUUID() + '.part');
  let output: FileHandle | undefined;
  try {
    output = await open(stage, 'wx', 0o600);
    const header = Buffer.alloc(12);
    MAGIC.copy(header);
    header.writeUInt32LE(initial.length, 8);
    await write(output, header, 0);
    await write(output, initial, 12);
    let position = 12 + initial.length;
    for (let i = 0; i < media.length; i++) {
      const hash = createHash('sha256');
      let length = 0;
      for await (const data of media[i].file.read()) {
        cancelled(valid);
        if (!length && (media[i].kind === 'system' || media[i].kind === 'microphone'))
          validateAudioSource(data, assets[i].bytes, Math.round(project.seconds * 48000));
        hash.update(data);
        await write(output, data, position);
        length += data.length;
        position += data.length;
      }
      if (length !== assets[i].bytes) throw Error('录制原片发生变化');
      assets[i].sha256 = hash.digest('hex');
    }
    const final = Buffer.from(JSON.stringify(manifest));
    if (final.length !== initial.length || position !== total) throw Error('录制工程封装失败');
    await write(output, final, 12);
    await output.sync();
    await output.close();
    output = undefined;
    cancelled(valid);
    commitRecording(stage, path);
  } finally {
    await output?.close().catch(() => {});
    await unlink(stage).catch(() => {});
  }
}
function validateAssets(manifest: Manifest) {
  const kinds: Kind[] = [
    'screen',
    ...(manifest.project.camera ? ['camera' as const] : []),
    ...(manifest.project.sources || []),
  ];
  if (
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== kinds.length ||
    manifest.assets.some(
      (v, i) =>
        !v ||
        v.kind !== kinds[i] ||
        !Number.isSafeInteger(v.bytes) ||
        v.bytes < 12 ||
        v.bytes > RECORD_BYTES ||
        typeof v.sha256 !== 'string' ||
        !/^[\da-f]{64}$/.test(v.sha256),
    )
  )
    throw Error('录制工程原片信息无效');
}
async function readManifest(input: FileHandle) {
  const size = (await input.stat()).size;
  if (size < 12 || size > 4 * RECORD_BYTES + PROJECT_METADATA_BYTES + 12)
    throw Error('录制工程大小无效');
  const header = await read(input, 12, 0),
    length = header.readUInt32LE(8);
  if (
    !header.subarray(0, 8).equals(MAGIC) ||
    length < 2 ||
    length > PROJECT_METADATA_BYTES ||
    length > size - 12
  )
    throw Error('不是受支持的 One 录制工程');
  let manifest: Manifest;
  try {
    manifest = JSON.parse((await read(input, length, 12)).toString('utf8'));
  } catch {
    throw Error('录制工程信息已损坏');
  }
  if (!manifest || typeof manifest !== 'object') throw Error('录制工程信息已损坏');
  manifest.project = recordingProject(manifest.project);
  validateAssets(manifest);
  if (12 + length + manifest.assets.reduce((n, v) => n + v.bytes, 0) !== size)
    throw Error('录制工程原片不完整或包含多余数据');
  return { manifest, offset: 12 + length };
}
/** Serve only the original screen track for lazy card posters, with byte ranges.
 * The caller resolves a managed material ID; this never accepts a renderer path. */
export async function recordingProjectPreview(path: string, request: Request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  const input = await open(path, 'r');
  let streaming = false;
  try {
    const { manifest, offset } = await readManifest(input);
    if (manifest.project.options.mode === 'audio') return new Response(null, { status: 404 });
    const bytes = manifest.assets[0].bytes;
    let range;
    try {
      range = recordingRange(request.headers.get('Range'), bytes);
    } catch {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes}` } });
    }
    const headers: Record<string, string> = {
      'Content-Type': recordingContentType(manifest.project.options),
      'Content-Length': String(range.end - range.start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${bytes}`;
    const stream =
      request.method === 'HEAD'
        ? null
        : input.createReadStream({
            start: offset + range.start,
            end: offset + range.end,
            autoClose: true,
          });
    streaming = !!stream;
    return new Response(stream ? (Readable.toWeb(stream) as ReadableStream) : null, {
      status: range.partial ? 206 : 200,
      headers,
    });
  } finally {
    if (!streaming) await input.close();
  }
}
/** Validate the complete file before publishing a new result. Partial imports remain private. */
export async function openRecordingProject(path: string, directory: string, valid: () => boolean) {
  const input = await open(path, 'r'),
    files: RecordingFile[] = [];
  let success = false;
  try {
    cancelled(valid);
    const { manifest, offset } = await readManifest(input);
    let position = offset;
    for (const asset of manifest.assets) {
      cancelled(valid);
      const source = asset.kind === 'system' || asset.kind === 'microphone';
      if (source)
        validateAudioSource(
          await read(input, Math.min(44, asset.bytes), position),
          asset.bytes,
          Math.round(manifest.project.seconds * 48000),
        );
      const container = source
          ? 'wav'
          : asset.kind === 'camera'
            ? 'mp4'
            : manifest.project.options.container || 'mp4',
        file = new RecordingFile(directory, RECORD_BYTES, container);
      files.push(file);
      await file.create();
      const hash = createHash('sha256');
      let remaining = asset.bytes,
        sequence = 0;
      while (remaining) {
        cancelled(valid);
        const size = Math.min(RECORD_CHUNK, remaining),
          data = await read(input, size, position);
        hash.update(data);
        await file.append(sequence++, data);
        remaining -= size;
        position += size;
      }
      if (hash.digest('hex') !== asset.sha256) throw Error('录制工程原片校验失败');
      await file.finish();
    }
    cancelled(valid);
    success = true;
    return {
      project: manifest.project,
      file: files[0],
      cameraFile: files[manifest.assets.findIndex((asset) => asset.kind === 'camera')] as
        | RecordingFile
        | undefined,
      audioFiles: Object.fromEntries(
        manifest.assets.flatMap((asset, index) =>
          asset.kind === 'system' || asset.kind === 'microphone'
            ? [[asset.kind, files[index]]]
            : [],
        ),
      ) as Partial<Record<RecordingAudioSource, RecordingFile>>,
    };
  } finally {
    await input.close();
    if (!success) await Promise.all(files.map((file) => file.dispose()));
  }
}
