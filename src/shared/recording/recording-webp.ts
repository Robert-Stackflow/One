/** Retain duration when libwebp optimizes a constant animation into a still image.
 * Container layout follows https://developers.google.com/speed/webp/docs/riff_container.
 * No image bitstream is decoded or recompressed here.
 */
export function animateRecordingWebp(
  bytes: Uint8Array,
  width: number,
  height: number,
  duration: number,
) {
  if (
    bytes.byteLength < 20 ||
    bytes.byteLength > 64 * 1024 * 1024 ||
    ![width, height, duration].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 40_000_000 ||
    duration < 1 ||
    duration > 0xffffff
  )
    throw Error('静态 WebP 动画参数无效');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length)
    throw Error('静态 WebP 数据不完整');
  const chunks: Uint8Array[] = [];
  let offset = 12,
    alpha = false,
    images = 0,
    length = 0;
  while (offset + 8 <= bytes.length) {
    const name = tag(offset),
      size = view.getUint32(offset + 4, true),
      end = offset + 8 + size + (size % 2);
    if (end > bytes.length) throw Error('静态 WebP 分块不完整');
    if (name === 'ANIM' || name === 'ANMF') throw Error('WebP 已包含动画');
    if (name === 'VP8X' && size >= 10) alpha = !!(bytes[offset + 8] & 0x10);
    if (name === 'ALPH' || name === 'VP8 ' || name === 'VP8L') {
      if (name === 'ALPH') alpha = true;
      else {
        images++;
        if (name === 'VP8L' && size >= 5 && bytes[offset + 12] & 0x10) alpha = true;
      }
      const chunk = bytes.subarray(offset, end);
      chunks.push(chunk);
      length += chunk.length;
    }
    offset = end;
  }
  if (offset !== bytes.length || images !== 1) throw Error('静态 WebP 图像分块无效');
  const output = new Uint8Array(68 + length),
    out = new DataView(output.buffer),
    text = new TextEncoder();
  const writeTag = (offset: number, name: string) => output.set(text.encode(name), offset),
    u24 = (offset: number, value: number) => {
      for (let i = 0; i < 3; i++) output[offset + i] = (value >>> (i * 8)) & 255;
    };
  writeTag(0, 'RIFF');
  out.setUint32(4, output.length - 8, true);
  writeTag(8, 'WEBP');
  writeTag(12, 'VP8X');
  out.setUint32(16, 10, true);
  output[20] = 2 | (alpha ? 16 : 0);
  u24(24, width - 1);
  u24(27, height - 1);
  writeTag(30, 'ANIM');
  out.setUint32(34, 6, true); // Transparent background, infinite loop.
  writeTag(44, 'ANMF');
  out.setUint32(48, 16 + length, true);
  u24(58, width - 1);
  u24(61, height - 1);
  u24(64, duration);
  output[67] = 2;
  offset = 68;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
