import type { TextPoint, TextQuad } from './text-document';
export type TextRotation = 0 | 1 | 2 | 3;
export interface TextView { width: number; height: number; scale: number; rotation: TextRotation }
export function textViewSize(view: TextView) {
  return { width: (view.rotation % 2 ? view.height : view.width) * view.scale,
    height: (view.rotation % 2 ? view.width : view.height) * view.scale };
}
export function imageToTextView(point: TextPoint, view: TextView): TextPoint {
  const { width: w, height: h, scale: s, rotation: r } = view;
  const [x, y] = r === 0 ? [point.x, point.y] : r === 1 ? [h - point.y, point.x] :
    r === 2 ? [w - point.x, h - point.y] : [point.y, w - point.x];
  return { x: x * s, y: y * s };
}
export function textViewToImage(point: TextPoint, view: TextView): TextPoint {
  const x = point.x / view.scale, y = point.y / view.scale;
  return view.rotation === 0 ? { x, y } : view.rotation === 1 ? { x: y, y: view.height - x } :
    view.rotation === 2 ? { x: view.width - x, y: view.height - y } : { x: view.width - y, y: x };
}
export function insideTextQuad(point: TextPoint, quad: TextQuad) {
  let sign = 0;
  for (let index = 0; index < 4; index++) {
    const a = quad[index], b = quad[(index + 1) % 4];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (!cross) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return sign !== 0;
}
