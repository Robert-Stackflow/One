import type { DiskNode } from './types';
export interface Tile { node: DiskNode; x: number; y: number; width: number; height: number }
/** Squarified treemap. Each row minimizes its worst aspect ratio. */
export function layout(nodes: DiskNode[], x: number, y: number, width: number, height: number): Tile[] {
  const list = nodes.filter(node => node.size > 0 && Number.isFinite(node.size)).sort((a,b) => b.size-a.size || a.path.localeCompare(b.path));
  if (!list.length || width <= 0 || height <= 0) return [];
  const factor = width*height/list.reduce((n,node) => n+node.size,0), result: Tile[] = [];
  const areas = list.map(node => node.size*factor);
  let start = 0;
  while (start < list.length) {
    const side = Math.min(width,height);
    if (side <= 0) break;
    let end = start+1, sum = areas[start], min = sum, max = sum;
    const worst = (total: number, low: number, high: number) => Math.max(side*side*high/(total*total),total*total/(side*side*low));
    let score = worst(sum,min,max);
    while (end < list.length) {
      const next = areas[end], nextSum = sum+next, nextMin = Math.min(min,next), nextMax = Math.max(max,next), nextScore = worst(nextSum,nextMin,nextMax);
      if (nextScore > score) break;
      sum = nextSum; min = nextMin; max = nextMax; score = nextScore; end++;
    }
    const vertical = width >= height; const thickness = sum/side;
    let offset = 0;
    for (let i=start;i<end;i++) {
      const length = areas[i]/thickness;
      result.push({ node: list[i], x: vertical ? x : x+offset, y: vertical ? y+offset : y, width: vertical ? thickness : length, height: vertical ? length : thickness });
      offset += length;
    }
    if (vertical) { x += thickness; width = Math.max(0,width-thickness); } else { y += thickness; height = Math.max(0,height-thickness); }
    start = end;
  }
  return result;
}
