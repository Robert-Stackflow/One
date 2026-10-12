import { t as tr } from './i18n';
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Region {
  displayId: number;
  sourceId: string;
  signature: string;
  rect: Rectangle;
  pixels: { width: number; height: number };
  screen: { width: number; height: number };
}
export function displaySignature(d: {
  id: number;
  bounds: Rectangle;
  scaleFactor: number;
  rotation: number;
}) {
  return JSON.stringify([
    d.id,
    d.bounds.x,
    d.bounds.y,
    d.bounds.width,
    d.bounds.height,
    d.scaleFactor,
    d.rotation,
  ]);
}
export function normalizedRegion(
  rect: Rectangle,
  viewport: { width: number; height: number },
): Rectangle {
  if (
    ![rect?.x, rect?.y, rect?.width, rect?.height, viewport?.width, viewport?.height].every(
      Number.isFinite,
    ) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 2 ||
    rect.height < 2 ||
    rect.x + rect.width > viewport.width ||
    rect.y + rect.height > viewport.height
  )
    throw new Error(tr('选区无效，请重新选择'));
  return {
    x: rect.x / viewport.width,
    y: rect.y / viewport.height,
    width: rect.width / viewport.width,
    height: rect.height / viewport.height,
  };
}
export function regionPixels(rect: Rectangle, width: number, height: number) {
  if (
    ![width, height].every(Number.isSafeInteger) ||
    width < 2 ||
    height < 2 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 40_000_000 ||
    ![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 + 1e-10 ||
    rect.y + rect.height > 1 + 1e-10
  )
    throw new Error(tr('选区或捕获尺寸无效'));
  const x = Math.floor(rect.x * width),
    y = Math.floor(rect.y * height),
    right = Math.min(width, Math.ceil((rect.x + rect.width) * width)),
    bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height));
  return { x, y, width: right - x, height: bottom - y };
}
export function regionVideo(rect: Rectangle, width: number, height: number, maxWidth: number) {
  const crop = regionPixels(rect, width, height),
    scale = Math.min(1, maxWidth / Math.max(crop.width, crop.height));
  const output = {
    width: Math.floor((crop.width * scale) / 2) * 2,
    height: Math.floor((crop.height * scale) / 2) * 2,
  };
  if (output.width < 2 || output.height < 2) throw new Error(tr('录制区域太小'));
  return { crop, output };
}
