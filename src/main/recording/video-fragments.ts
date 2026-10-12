import { open } from 'node:fs/promises';
/** Keep only complete movie fragments. The source is never truncated in place. */
export async function completeVideoPrefix(path: string) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    if (size < 32 || size > 1024 ** 3) throw Error('视频草稿大小无效');
    const header = Buffer.alloc(16);
    let offset = 0,
      movie = false,
      fragment = false,
      complete = 0,
      count = 0;
    while (offset + 8 <= size) {
      if (++count > 100000) throw Error('视频草稿包含过多片段');
      const read = await file.read(header, 0, Math.min(16, size - offset), offset);
      if (read.bytesRead < 8) break;
      const type = header.toString('ascii', 4, 8),
        short = header.readUInt32BE(0);
      const length =
        short === 1 ? (read.bytesRead >= 16 ? Number(header.readBigUInt64BE(8)) : -1) : short;
      const head = short === 1 ? 16 : 8;
      // Open-ended/truncated boxes are not proof of a complete fragment.
      if (!Number.isSafeInteger(length) || length < head || offset + length > size) break;
      if (offset === 0 && type !== 'ftyp') throw Error('视频草稿不是 MP4');
      if (type === 'moov') movie = true;
      if (type === 'moof') {
        if (!movie) throw Error('视频草稿缺少编码信息');
        fragment = true;
      } else if (type === 'mdat') {
        if (!fragment) throw Error('视频草稿片段顺序无效');
        complete = offset + length;
        fragment = false;
      }
      offset += length;
    }
    if (!movie || !complete) throw Error('视频草稿没有完整可恢复片段');
    return complete;
  } finally {
    await file.close();
  }
}
