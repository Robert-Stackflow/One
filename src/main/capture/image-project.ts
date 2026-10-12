import { IMAGE_PROJECT_FORMAT } from '../../shared/media-project';
import { createHash, randomUUID } from 'node:crypto';
import { open, stat, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  imageProject,
  IMAGE_PROJECT_METADATA_BYTES,
  type ImageProject,
} from '../../shared/capture/image-project';
import { IMAGE_BYTES, imageDimensions } from '../../shared/capture/image-limits';
import { commitImageFile } from '../media-file';
import { gzipSync, gunzipSync } from 'node:zlib';

const HISTORY_BYTES = 128 * 1024 * 1024;

const MAGIC = Buffer.from(IMAGE_PROJECT_FORMAT.magic);
const HEADER_BYTES = MAGIC.length + 4;
function pngSize(png: Buffer) {
  if (
    png.length < 33 ||
    png.length > IMAGE_BYTES ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw Error('图片工程原图无效');
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  imageDimensions(size.width, size.height);
  return size;
}
const hash = (png: Buffer) => createHash('sha256').update(png).digest('hex');
const check = (valid: () => boolean) => {
  if (!valid()) throw Error('图片工程操作已取消');
};
async function read(handle: FileHandle, bytes: number, position: number) {
  const data = Buffer.alloc(bytes);
  let offset = 0;
  while (offset < bytes) {
    const result = await handle.read(data, offset, bytes - offset, position + offset);
    if (!result.bytesRead) throw Error('图片工程不完整');
    offset += result.bytesRead;
  }
  return data;
}
function unchanged(a: Awaited<ReturnType<typeof stat>>, b: Awaited<ReturnType<typeof stat>>) {
  return a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
export async function readImageProject(file: string, valid = () => true) {
  check(valid);
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size < HEADER_BYTES + 33 ||
      before.size > HEADER_BYTES + IMAGE_PROJECT_METADATA_BYTES + IMAGE_BYTES
    )
      throw Error('图片工程大小无效');
    const header = await read(handle, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw Error('不是 One 图片工程');
    const bytes = header.readUInt32LE(MAGIC.length);
    const pngBytes = before.size - HEADER_BYTES - bytes;
    if (!bytes || bytes > IMAGE_PROJECT_METADATA_BYTES || pngBytes < 33 || pngBytes > IMAGE_BYTES)
      throw Error('图片工程大小无效');
    const manifest = JSON.parse((await read(handle, bytes, HEADER_BYTES)).toString('utf8'));
    if (
      !manifest ||
      manifest.png?.bytes !== pngBytes ||
      typeof manifest.png?.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(manifest.png.sha256)
    )
      throw Error('图片工程原图信息无效');
    check(valid);
    const png = await read(handle, pngBytes, HEADER_BYTES + bytes);
    try {
      if (hash(png) !== manifest.png.sha256) throw Error('图片工程原图校验失败');
      if (manifest.history !== undefined) {
        if (typeof manifest.history !== 'string' || manifest.project.history !== undefined)
          throw Error('图片操作历史无效');
        manifest.project.history = JSON.parse(
          gunzipSync(Buffer.from(manifest.history, 'base64'), {
            maxOutputLength: HISTORY_BYTES,
          }).toString('utf8'),
        );
      }
      const project = imageProject(manifest.project, pngSize(png));
      if (!unchanged(before, await handle.stat())) throw Error('图片工程在读取时已改变');
      check(valid);
      return { project, png };
    } catch (error) {
      png.fill(0);
      throw error;
    }
  } finally {
    await handle.close();
  }
}
/** Write beside the user-selected target, then replace only the unchanged approved file. */
export async function writeImageProject(
  file: string,
  value: ImageProject,
  png: Buffer,
  valid = () => true,
) {
  check(valid);
  const project = imageProject(value, pngSize(png));
  const { history, ...saved } = project;
  const historyBytes = history ? Buffer.from(JSON.stringify(history)) : undefined;
  if (historyBytes && historyBytes.length > HISTORY_BYTES)
    throw Error('图片操作历史过大，无法保存工程');
  const metadata = Buffer.from(
    JSON.stringify({
      project: saved,
      ...(historyBytes ? { history: gzipSync(historyBytes).toString('base64') } : {}),
      png: { bytes: png.length, sha256: hash(png) },
    }),
  );
  if (metadata.length > IMAGE_PROJECT_METADATA_BYTES) throw Error('图片工程标注信息过大');
  let previous: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    previous = await stat(file);
    if (!previous.isFile()) throw Error('图片工程目标不是文件');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stage = join(dirname(file), '.One-image-project-' + randomUUID() + '.part');
  let handle: FileHandle | undefined;
  let owned = false;
  try {
    handle = await open(stage, 'wx', 0o600);
    owned = true;
    const header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header);
    header.writeUInt32LE(metadata.length, MAGIC.length);
    await handle.writeFile(header);
    await handle.writeFile(metadata);
    await handle.writeFile(png);
    await handle.sync();
    await handle.close();
    handle = undefined;
    check(valid);
    if (previous && !unchanged(previous, await stat(file)))
      throw Error('目标文件已改变，请重新保存');
    check(valid);
    await commitImageFile(stage, file, !!previous);
  } finally {
    try {
      await handle?.close();
    } finally {
      if (owned) await unlink(stage).catch(() => {});
    }
  }
}
