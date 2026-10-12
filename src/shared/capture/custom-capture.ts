import type { Rectangle } from './region';
export interface CaptureSize {
  width: number;
  height: number;
}
export interface CustomCapture {
  position: boolean;
  x: number;
  y: number;
  size: boolean;
  width: number;
  height: number;
  delayed: boolean;
  delay: number;
  presets: CaptureSize[];
}
export const defaultCustomCapture = (): CustomCapture => ({
  position: false,
  x: 0,
  y: 0,
  size: true,
  width: 640,
  height: 480,
  delayed: false,
  delay: 2,
  presets: [
    { width: 100, height: 100 },
    { width: 500, height: 500 },
    { width: 640, height: 480 },
    { width: 1024, height: 768 },
  ],
});
export function customCaptureFrom(value: unknown): CustomCapture {
  const v = value as CustomCapture;
  if (
    !v ||
    typeof v !== 'object' ||
    ['position', 'size', 'delayed'].some((k) => typeof v[k as 'size'] !== 'boolean') ||
    !Number.isSafeInteger(v.x) ||
    !Number.isSafeInteger(v.y) ||
    v.x < 0 ||
    v.y < 0 ||
    v.x > 32768 ||
    v.y > 32768 ||
    !Number.isFinite(v.delay) ||
    v.delay < 0 ||
    v.delay > 60 ||
    !Array.isArray(v.presets) ||
    v.presets.length > 24
  )
    throw Error('自定义截屏参数无效');
  const size = (s: CaptureSize) => {
    if (
      !s ||
      !Number.isSafeInteger(s.width) ||
      !Number.isSafeInteger(s.height) ||
      s.width < 2 ||
      s.height < 2 ||
      s.width > 32768 ||
      s.height > 32768
    )
      throw Error('截屏尺寸需为 2–32768 像素');
    return { width: s.width, height: s.height };
  };
  const presets = v.presets.map(size);
  if (new Set(presets.map((s) => s.width + 'x' + s.height)).size !== presets.length)
    throw Error('截屏预设尺寸不能重复');
  return {
    position: v.position,
    x: v.x,
    y: v.y,
    size: v.size,
    ...size(v),
    delayed: v.delayed,
    delay: v.delay,
    presets,
  };
}
/** Coordinates and dimensions are physical pixels relative to the chosen monitor. */
export function customCaptureSelection(
  value: CustomCapture,
  width: number,
  height: number,
): Rectangle | undefined {
  const v = customCaptureFrom(value);
  if (!v.position && !v.size) return undefined;
  const w = v.size ? v.width : width - v.x,
    h = v.size ? v.height : height - v.y;
  const x = v.position ? v.x : Math.floor((width - w) / 2),
    y = v.position ? v.y : Math.floor((height - h) / 2);
  if (x < 0 || y < 0 || w < 2 || h < 2 || x + w > width || y + h > height)
    throw Error('截屏区域超出当前显示器，请调整位置或尺寸');
  return { x, y, width: w, height: h };
}
