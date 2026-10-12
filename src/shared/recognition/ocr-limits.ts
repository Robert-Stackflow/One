export const OCR_PIXELS = 12_000_000,
  OCR_EDGE = 8192,
  OCR_TEXT = 1024 * 1024;
export function ocrDimensions(width: number, height: number) {
  if (
    ![width, height].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width > OCR_EDGE ||
    height > OCR_EDGE ||
    width * height > OCR_PIXELS
  )
    throw Error('文字识别支持最多 1,200 万像素、最长边 8,192 像素，请先裁剪图片');
  return { width, height };
}
