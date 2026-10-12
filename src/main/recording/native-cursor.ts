import { open, lstat, readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import {
  CURSOR_EVENTS,
  CURSOR_BYTES,
  cursorEvent,
  cursorAnimation,
  recordingCursor,
  type CursorEvent,
  type CursorShape,
} from '../../shared/recording/recording-cursor';

export async function loadNativeCursor(
  path: string,
  width: number,
  height: number,
  samples: number,
  recovery = false,
) {
  const journal = path + '.cursor.jsonl',
    info = await lstat(journal);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
    throw Error('光标时间轴文件无效');
  const handle = await open(journal, 'r'),
    events: CursorEvent[] = [],
    ids = new Set<number>();
  let tail = '',
    position = 0;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      tail += buffer.toString('utf8', 0, bytesRead);
      let end = tail.indexOf('\n');
      while (end >= 0) {
        if (end > 1024) throw Error('光标时间轴行过长');
        const event = cursorEvent(JSON.parse(tail.slice(0, end)), width, height);
        tail = tail.slice(end + 1);
        if (event.sample <= samples) {
          events.push(event);
          if (event.shape) ids.add(event.shape);
        } else if (!recovery) throw Error('光标时间轴超过录制时长');
        if (events.length > CURSOR_EVENTS) throw Error('光标时间轴容量无效');
        end = tail.indexOf('\n');
      }
      if (tail.length > 1024) throw Error('光标时间轴行过长');
      await setImmediate();
    }
    if (tail.trim() && !recovery) throw Error('光标时间轴不完整');
  } finally {
    await handle.close();
  }
  const shapes: CursorShape[] = [];
  let total = 0;
  // Iterating the set also visits the bounded frame references added by animation metadata.
  for (const id of ids) {
    const file = path + '.cursor-' + id + '.bin',
      info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 21 || info.size > 16 + 256 * 256 * 5)
      throw Error('光标素材文件无效');
    const bytes = await readFile(file),
      width = bytes.readUInt32LE(0),
      height = bytes.readUInt32LE(4);
    if (
      width < 1 ||
      height < 1 ||
      width > 256 ||
      height > 256 ||
      bytes.length !== 16 + width * height * 5
    )
      throw Error('光标素材尺寸无效');
    total += bytes.length - 16;
    if (total > CURSOR_BYTES) throw Error('光标素材容量无效');
    let animation: CursorShape['animation'];
    const animationFile = path + '.cursor-' + id + '.animation.json';
    const animationInfo = await lstat(animationFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (animationInfo) {
      if (
        !animationInfo.isFile() ||
        animationInfo.isSymbolicLink() ||
        animationInfo.size > 16 * 1024
      )
        throw Error('光标动画文件无效');
      animation = cursorAnimation(JSON.parse(await readFile(animationFile, 'utf8')));
      for (const step of animation) ids.add(step.shape);
    }
    shapes.push({
      id,
      width,
      height,
      hotspotX: bytes.readUInt32LE(8),
      hotspotY: bytes.readUInt32LE(12),
      pixels: bytes.subarray(16).toString('base64'),
      ...(animation ? { animation } : {}),
    });
  }
  return recordingCursor(
    { events, shapes: shapes.sort((a, b) => a.id - b.id) },
    width,
    height,
    samples,
  );
}
