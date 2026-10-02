import type { DiskNode } from './types';

export interface Tile { node: DiskNode; x: number; y: number; width: number; height: number }
interface Band { start: number; end: number; x: number; y: number; width: number; height: number; vertical: boolean }
type Visitor = (node: DiskNode, x: number, y: number, width: number, height: number) => void;

/** Squarified strips keep one reference and one offset per item, without retaining a Tile object per file. */
export class TreemapLayout {
  private readonly nodes: DiskNode[];
  private readonly offsets: Float64Array;
  private readonly bands: Band[] = [];

  constructor(nodes: DiskNode[], private readonly x: number, private readonly y: number, private readonly width: number, private readonly height: number) {
    this.nodes = Number.isFinite(x + y + width + height) && width > 0 && height > 0
      ? nodes.filter(node => node.size > 0 && Number.isFinite(node.size)).sort((a,b) => b.size-a.size || a.path.localeCompare(b.path)) : [];
    this.offsets = new Float64Array(this.nodes.length);
    if (!this.nodes.length) return;
    // Normalize before summing so even very large finite sizes cannot overflow the total.
    const largest = this.nodes[0].size;
    let total = 0;
    for (const node of this.nodes) total += node.size / largest;
    const area = width * height / total;
    for (let i = 0; i < this.nodes.length; i++) this.offsets[i] = this.nodes[i].size / largest * area;
    let start = 0;
    while (start < this.nodes.length && width > 0 && height > 0) {
      const side = Math.min(width,height);
      let end = start+1, sum = this.offsets[start], min = sum, max = sum;
      const worst = (sum: number, min: number, max: number) => Math.max(side*side*max/(sum*sum),sum*sum/(side*side*min));
      let score = worst(sum,min,max);
      while (end < this.nodes.length) {
        const next = this.offsets[end], nextSum = sum+next, nextMin = Math.min(min,next), nextMax = Math.max(max,next), nextScore = worst(nextSum,nextMin,nextMax);
        if (nextScore > score) break;
        sum = nextSum; min = nextMin; max = nextMax; score = nextScore; end++;
      }
      const vertical = width >= height;
      const thickness = end === this.nodes.length ? (vertical ? width : height) : Math.min(sum/side,vertical ? width : height);
      this.bands.push({ start,end,x,y,width:vertical ? thickness : width,height:vertical ? height : thickness,vertical });
      let offset = 0;
      for (let i = start; i < end; i++) {
        offset = i === end-1 ? side : offset+this.offsets[i]/thickness;
        this.offsets[i] = offset;
      }
      if (vertical) { x += thickness; width = Math.max(0,width-thickness); }
      else { y += thickness; height = Math.max(0,height-thickness); }
      start = end;
    }
  }

  forEach(visit: Visitor) {
    for (const band of this.bands) {
      let offset = 0;
      for (let i = band.start; i < band.end; i++) {
        const next = this.offsets[i];
        visit(this.nodes[i],band.vertical ? band.x : band.x+offset,band.vertical ? band.y+offset : band.y,band.vertical ? band.width : next-offset,band.vertical ? next-offset : band.height);
        offset = next;
      }
    }
  }

  /** Strips advance monotonically on both axes; both strip and item lookup are logarithmic. */
  hit(x: number, y: number): Tile | undefined {
    if (!(x >= this.x && y >= this.y && x < this.x+this.width && y < this.y+this.height)) return;
    let low = 0, high = this.bands.length-1;
    while (low <= high) {
      const mid = (low+high) >>> 1, band = this.bands[mid];
      if (x < band.x || y < band.y) { high = mid-1; continue; }
      if (band.vertical ? x >= band.x+band.width : y >= band.y+band.height) { low = mid+1; continue; }
      const offset = band.vertical ? y-band.y : x-band.x;
      let first = band.start, last = band.end;
      while (first < last) { const i = (first+last) >>> 1; if (this.offsets[i] <= offset) first = i+1; else last = i; }
      return first < band.end ? this.tile(band,first) : undefined;
    }
  }

  find(node: DiskNode): Tile | undefined {
    let index = this.nodes.indexOf(node);
    // Filtered directory nodes are clones, while the selection belongs to the live scan tree.
    if (index < 0) index = this.nodes.findIndex(item => item.path === node.path);
    if (index < 0) return;
    let low = 0, high = this.bands.length-1;
    while (low <= high) {
      const mid = (low+high) >>> 1, band = this.bands[mid];
      if (index < band.start) high = mid-1;
      else if (index >= band.end) low = mid+1;
      else return this.tile(band,index);
    }
  }

  private tile(band: Band, index: number): Tile {
    const offset = index === band.start ? 0 : this.offsets[index-1], length = this.offsets[index]-offset;
    return { node:this.nodes[index],x:band.vertical ? band.x : band.x+offset,y:band.vertical ? band.y+offset : band.y,width:band.vertical ? band.width : length,height:band.vertical ? length : band.height };
  }
}

/** Compatibility helper for callers that need an explicit tile array. */
export function layout(nodes: DiskNode[], x: number, y: number, width: number, height: number): Tile[] {
  const result: Tile[] = [];
  new TreemapLayout(nodes,x,y,width,height).forEach((node,x,y,width,height) => result.push({node,x,y,width,height}));
  return result;
}
