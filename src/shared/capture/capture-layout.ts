import { imageDimensions, IMAGE_PIXELS } from './image-limits';
import type { Rectangle } from './region';
export const CAPTURE_DISPLAYS = 32;
/** Physical pixel placement shared by window and desktop compositions. Never rescale a layer. */
export function captureLayerLayout(layers: Rectangle[], maximum = CAPTURE_DISPLAYS) {
  if (!Array.isArray(layers) || !layers.length || layers.length > maximum)
    throw Error('组合来源数量无效');
  let pixels = 0;
  for (const r of layers) {
    if (
      !r ||
      ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
      Math.abs(r.x) > 100000 ||
      Math.abs(r.y) > 100000
    )
      throw Error('组合来源位置无效');
    imageDimensions(r.width, r.height);
    pixels += r.width * r.height;
  }
  if (pixels > IMAGE_PIXELS) throw Error('组合来源总量超过 4,000 万像素');
  const x = Math.min(...layers.map((r) => r.x)),
    y = Math.min(...layers.map((r) => r.y)),
    width = Math.max(...layers.map((r) => r.x + r.width)) - x,
    height = Math.max(...layers.map((r) => r.y + r.height)) - y;
  imageDimensions(width, height);
  return { x, y, width, height, layers: layers.map((r) => ({ ...r, x: r.x - x, y: r.y - y })) };
}
