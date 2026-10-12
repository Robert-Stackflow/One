import { t as tr } from './i18n';

// Originals, capture sessions, clipboard output and the asset library share one capacity.
export const IMAGE_PIXELS = 40_000_000;
export const IMAGE_EDGE = 16384;
export const IMAGE_BYTES = 64 * 1024 * 1024;
export const IMAGE_BASE64 = 4 * Math.ceil(IMAGE_BYTES / 3);

export function imageDimensions(width: number, height: number) {
  if (
    ![width, height].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width > IMAGE_EDGE ||
    height > IMAGE_EDGE ||
    width * height > IMAGE_PIXELS
  )
    throw Error(tr('图片支持最多 4,000 万像素、最长边 16,384 像素'));
  return { width, height };
}
