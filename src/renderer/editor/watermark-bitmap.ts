import type { WatermarkImage } from '../../shared/capture/watermark';

const cache = new Map<string, { canvas: HTMLCanvasElement; width: number; height: number }>();
let bytes = 0;
/** Synchronous RGBA snapshots keep preview, output effects and export on the same paint path. */
export function watermarkBitmap(image: WatermarkImage) {
  const existing = cache.get(image.rgba);
  if (existing && existing.width === image.width && existing.height === image.height) {
    cache.delete(image.rgba);
    cache.set(image.rgba, existing);
    return existing.canvas;
  }
  if (existing) {
    bytes -= existing.width * existing.height * 4;
    existing.canvas.width = existing.canvas.height = 0;
    cache.delete(image.rgba);
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const decoded = atob(image.rgba),
    pixels = new Uint8ClampedArray(decoded.length);
  for (let at = 0; at < decoded.length; at++) pixels[at] = decoded.charCodeAt(at);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  cache.set(image.rgba, { canvas, width: image.width, height: image.height });
  bytes += image.width * image.height * 4;
  while (bytes > 16 * 1024 * 1024 || cache.size > 64) {
    const [key, value] = cache.entries().next().value!;
    bytes -= value.width * value.height * 4;
    value.canvas.width = value.canvas.height = 0;
    cache.delete(key);
  }
  return canvas;
}
