import { captureLayerLayout } from './capture-layout';
import type { Rectangle } from './region';
export const CAPTURE_WINDOWS = 8;
export interface CaptureWindowPlacement {
  token: string;
  x: number;
  y: number;
}
export function windowPlacements(
  value: unknown,
  tokens: string[],
): CaptureWindowPlacement[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== tokens.length) throw Error('窗口布局无效');
  return value.map((item, index) => {
    if (
      !item ||
      item.token !== tokens[index] ||
      ![item.x, item.y].every(Number.isSafeInteger) ||
      Math.abs(item.x) > 100000 ||
      Math.abs(item.y) > 100000
    )
      throw Error('窗口布局无效');
    return { token: item.token, x: item.x, y: item.y };
  });
}
/** Compact rows without overlap; original pixel sizes and layer order are retained. */
export function arrangeWindows(windows: Rectangle[], gap = 24): Rectangle[] {
  if (!windows.length) return [];
  const width = Math.max(
    ...windows.map((item) => item.width),
    Math.ceil(Math.sqrt(windows.reduce((area, item) => area + item.width * item.height, 0) * 1.6)),
  );
  let x = 0,
    y = 0,
    row = 0;
  return windows.map((item) => {
    if (x && x + item.width > width) {
      x = 0;
      y += row + gap;
      row = 0;
    }
    const placed = { ...item, x, y };
    x += item.width + gap;
    row = Math.max(row, item.height);
    return placed;
  });
}
/** Order is bottom to top. Gaps remain transparent; no window is stretched. */
export function captureWindowLayout(windows: Rectangle[]) {
  if (!Array.isArray(windows) || !windows.length || windows.length > CAPTURE_WINDOWS)
    throw Error('请选择 1–8 个窗口');
  return captureLayerLayout(windows, CAPTURE_WINDOWS);
}
