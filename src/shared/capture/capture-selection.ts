import type { Point } from './image-document';
import type { Rectangle } from './region';
export type CaptureSelectionMode = 'rectangle' | 'free' | 'polygon';
export interface SelectionMask {
  kind: 'free' | 'polygon';
  points: Point[];
}
export const SELECTION_POINTS = 8192;
export function maskBounds(points: Point[]): Rectangle {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function selectionMask(value: unknown, width: number, height: number): SelectionMask {
  const mask = value as SelectionMask;
  if (
    !mask ||
    !['free', 'polygon'].includes(mask.kind) ||
    !Array.isArray(mask.points) ||
    mask.points.length < 3 ||
    mask.points.length > SELECTION_POINTS ||
    mask.points.some(
      (p) =>
        !p ||
        !Number.isSafeInteger(p.x) ||
        !Number.isSafeInteger(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > width ||
        p.y > height,
    )
  )
    throw Error('选区轮廓无效，请重新绘制');
  const bounds = maskBounds(mask.points),
    a = mask.points[0],
    b = mask.points.find((p) => p.x !== a.x || p.y !== a.y);
  if (
    bounds.width < 2 ||
    bounds.height < 2 ||
    !b ||
    !mask.points.some((p) => (b.x - a.x) * (p.y - a.y) !== (b.y - a.y) * (p.x - a.x))
  )
    throw Error('选区需要至少三个不共线的点');
  return { kind: mask.kind, points: mask.points.map((p) => ({ x: p.x, y: p.y })) };
}
/** Use the same even-odd rule for hit testing and Canvas clipping, including crossing paths. */
export function maskContains(mask: SelectionMask, p: Point) {
  let inside = false;
  for (let i = 0, j = mask.points.length - 1; i < mask.points.length; j = i++) {
    const a = mask.points[i],
      b = mask.points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function remapSelectionMask(
  mask: SelectionMask,
  before: Rectangle,
  after: Rectangle,
): SelectionMask {
  return {
    kind: mask.kind,
    points: mask.points.map((p) => ({
      x: Math.round(after.x + ((p.x - before.x) * after.width) / before.width),
      y: Math.round(after.y + ((p.y - before.y) * after.height) / before.height),
    })),
  };
}
/** Clip before translating a cropped document, using the same even-odd contour. */
export function cropSelectionMask(mask: SelectionMask, rect: Rectangle): SelectionMask {
  let points = mask.points;
  for (const [axis, edge, greater] of [
    ['x', rect.x, true],
    ['x', rect.x + rect.width, false],
    ['y', rect.y, true],
    ['y', rect.y + rect.height, false],
  ] as const) {
    const clipped: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length],
        b = points[i],
        aInside = greater ? a[axis] >= edge : a[axis] <= edge,
        bInside = greater ? b[axis] >= edge : b[axis] <= edge;
      if (aInside !== bInside) {
        const ratio = (edge - a[axis]) / (b[axis] - a[axis]);
        clipped.push({
          x: Math.round(a.x + (b.x - a.x) * ratio),
          y: Math.round(a.y + (b.y - a.y) * ratio),
        });
      }
      if (bInside) clipped.push(b);
    }
    points = clipped;
  }
  return { kind: mask.kind, points };
}
