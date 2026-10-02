import type { Edge, EdgeSetting } from './types';
type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
export function edgeAt(point: Point, bounds: Bounds, others: Bounds[], width: number, settings: Record<Edge, EdgeSetting>): Edge | null {
  const { x, y, width: w, height: h } = bounds;
  if (point.x < x || point.x >= x + w || point.y < y || point.y >= y + h) return null;
  const candidates: { edge: Edge; distance: number; across: Point }[] = [
    { edge: 'top', distance: point.y-y, across: { x: point.x, y: y-1 } },
    { edge: 'right', distance: x+w-1-point.x, across: { x: x+w, y: point.y } },
    { edge: 'bottom', distance: y+h-1-point.y, across: { x: point.x, y: y+h } },
    { edge: 'left', distance: point.x-x, across: { x: x-1, y: point.y } }
  ];
  // At a corner choose the closest enabled outer edge, with stable tie-breaking.
  return candidates.filter(c => c.distance < width && settings[c.edge].action !== 'off' && !others.some(b => c.across.x >= b.x && c.across.x < b.x+b.width && c.across.y >= b.y && c.across.y < b.y+b.height)).sort((a,b) => a.distance-b.distance)[0]?.edge ?? null;
}
