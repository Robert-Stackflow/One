import { join, resolve, sep } from 'node:path';
import {
  lstat,
  realpath,
  readFile,
  readdir,
  open,
  mkdir,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import type { AudioDraft } from '../../shared/recording/native-audio';
import type { RecordingFile } from './recording-file';
const identity = /^audio-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function owned(root: string, id: string) {
  if (!identity.test(id)) throw Error('录音草稿已失效');
  const base = await realpath(root),
    path = join(base, id);
  const info = await lstat(path);
  if (
    base !== resolve(root) ||
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(path)) !== path ||
    !path.startsWith(base + sep)
  )
    throw Error('录音草稿目录无效');
  const marker = join(path, '.one-audio'),
    markerInfo = await lstat(marker);
  if (
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    markerInfo.size !== Buffer.byteLength('One native audio') ||
    (await readFile(marker, 'utf8')) !== 'One native audio'
  )
    throw Error('录音草稿标记无效');
  return path;
}
async function metadata(path: string) {
  const file = join(path, 'draft.json'),
    info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw Error('录音草稿信息无效');
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !['wav', 'm4a'].includes(value.format) ||
    typeof value.systemAudio !== 'boolean' ||
    typeof value.microphone !== 'boolean' ||
    (!value.systemAudio && !value.microphone)
  )
    throw Error('录音草稿信息无效');
  return {
    createdAt: value.createdAt as number,
    format: value.format as AudioDraft['format'],
    systemAudio: value.systemAudio as boolean,
    microphone: value.microphone as boolean,
  };
}
async function pcm(
  path: string,
): Promise<{ handle: FileHandle; header: Buffer; samples: number; bytes: number }> {
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 44 ||
    before.size > 44 + 48000 * 3600 * 4
  )
    throw Error('录音草稿内容无效');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat(),
      header = Buffer.alloc(44);
    if (
      info.ino !== before.ino ||
      info.size !== before.size ||
      (await handle.read(header, 0, 44, 0)).bytesRead !== 44 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      header.readUInt32LE(16) !== 16 ||
      header.readUInt16LE(20) !== 1 ||
      header.readUInt16LE(22) !== 2 ||
      header.readUInt32LE(24) !== 48000 ||
      header.readUInt32LE(28) !== 192000 ||
      header.readUInt16LE(32) !== 4 ||
      header.readUInt16LE(34) !== 16 ||
      header.toString('ascii', 36, 40) !== 'data'
    )
      throw Error('录音草稿格式无效');
    // Trust only complete PCM frames on disk. A killed process may leave stale
    // RIFF sizes or a partial final frame; never change the retained original.
    const samples = Math.floor((info.size - 44) / 4),
      bytes = 44 + samples * 4;
    header.writeUInt32LE(bytes - 8, 4);
    header.writeUInt32LE(bytes - 44, 40);
    return { handle, header, samples, bytes };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function listAudioDrafts(
  root: string,
  excluded: string[] = [],
): Promise<AudioDraft[]> {
  await mkdir(root, { recursive: true });
  const drafts: AudioDraft[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !identity.test(entry.name) || excluded.includes(entry.name))
      continue;
    try {
      const path = await owned(root, entry.name),
        value = await metadata(path);
      let samples = 0,
        bytes = 0;
      try {
        const source = await pcm(
          join(path, value.format === 'wav' ? 'capture.wav' : 'recovery.wav'),
        );
        samples = source.samples;
        bytes = source.bytes;
        await source.handle.close();
      } catch {
        /* Invalid or empty captures can be explicitly discarded. */
      }
      drafts.push({ id: entry.name, ...value, samples, bytes });
    } catch {
      /* Unowned directories are neither exposed nor removed. */
    }
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}
export async function recoverAudioDraft(
  root: string,
  id: string,
  file: RecordingFile,
  valid: () => boolean,
) {
  const path = await owned(root, id),
    value = await metadata(path);
  const source = await pcm(join(path, value.format === 'wav' ? 'capture.wav' : 'recovery.wav'));
  try {
    if (!source.samples) throw Error('录音草稿没有完整声音样本');
    const buffer = Buffer.alloc(2 * 1024 * 1024);
    try {
      let position = 0,
        index = 0;
      while (position < source.bytes) {
        if (!valid()) throw Error('录音恢复已取消');
        const read = await source.handle.read(
          buffer,
          0,
          Math.min(buffer.length, source.bytes - position),
          position,
        );
        if (!read.bytesRead) throw Error('录音草稿不完整');
        if (position < 44)
          source.header.copy(buffer, 0, position, Math.min(44, position + read.bytesRead));
        await file.append(index++, buffer.subarray(0, read.bytesRead));
        position += read.bytesRead;
      }
      if (!valid()) throw Error('录音恢复已取消');
      await file.finish();
      return { samples: source.samples, bytes: source.bytes };
    } finally {
      buffer.fill(0);
    }
  } finally {
    await source.handle.close();
  }
}
export async function discardAudioDraft(root: string, id: string) {
  const path = await owned(root, id);
  await rm(path, { recursive: true, force: true });
}
