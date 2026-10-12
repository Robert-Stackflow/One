import { t as tr } from '../../shared/capture/i18n';
import { IMAGE_BYTES } from '../../shared/capture/image-limits';

const ENCODE_CHUNK = 192 * 1024; // Multiple of three: only the final block has padding.
type Base64Bytes = Uint8Array & { toBase64?: () => string };
export async function canvasPng(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error(tr('PNG 图片无效')))),
      'image/png',
    ),
  );
  if (blob.size > IMAGE_BYTES) throw Error(tr('PNG 文件超过 64 MiB，请缩小选区'));
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    parts: string[] = [];
  try {
    for (let offset = 0; offset < bytes.length; offset += ENCODE_CHUNK) {
      const chunk = bytes.subarray(offset, offset + ENCODE_CHUNK) as Base64Bytes;
      if (typeof chunk.toBase64 === 'function') parts.push(chunk.toBase64());
      else {
        const text: string[] = [];
        for (let i = 0; i < chunk.length; i += 8192)
          text.push(String.fromCharCode(...chunk.subarray(i, i + 8192)));
        parts.push(btoa(text.join('')));
      }
      if (offset + ENCODE_CHUNK < bytes.length)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return parts.join('');
  } finally {
    bytes.fill(0);
  }
}
