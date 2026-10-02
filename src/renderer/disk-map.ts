import type { DiskNode } from '../shared/types';
import { TreemapLayout, type Tile } from '../shared/treemap';
import { size } from './ui';

interface Scene { layout: TreemapLayout; children: Map<DiskNode,Scene> }

/** Static map and transient outlines have separate canvases, so hover never repaints the files. */
export class DiskMap {
  private readonly context: CanvasRenderingContext2D;
  private readonly overlay: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private scene?: Scene;
  private outlined: Tile[] = [];
  private selected?: DiskNode;
  private selectedTile?: Tile;
  private dark = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'map-outlines';
    this.overlay.setAttribute('aria-hidden','true');
    canvas.after(this.overlay);
    this.overlayContext = this.overlay.getContext('2d')!;
  }

  paint(nodes: DiskNode[], depthLimit: number) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (width < 1 || height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1,2.5);
    const pixelWidth = Math.round(width*ratio), pixelHeight = Math.round(height*ratio);
    for (const canvas of [this.canvas,this.overlay]) {
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.getContext('2d')!.setTransform(ratio,0,0,ratio,0,0);
    }
    this.context.clearRect(0,0,width,height);
    this.overlayContext.clearRect(0,0,width,height);
    this.outlined = []; this.selected = undefined; this.selectedTile = undefined;
    this.dark = document.documentElement.dataset.theme === 'dark';
    const context = this.context, font = getComputedStyle(this.canvas).fontFamily;
    const directories = this.dark ? ['#344658','#3e5265','#485e72','#536b7e'] : ['#bdcbdc','#cbd6e3','#d8e0ea','#e3e9f1'];
    const colors = this.dark ? ['#385f52','#554767','#6c523a','#35586a','#454c57'] : ['#afd0c1','#c5b8df','#dfc5a7','#b8d4e1','#ced1d6'];
    const extensions = new Map<string,string>();
    const color = (node: DiskNode, depth: number) => {
      if (node.directory) return directories[Math.min(depth,3)];
      const extension = node.name.slice(node.name.lastIndexOf('.')+1).toLowerCase();
      let result = extensions.get(extension);
      if (!result) {
        const category = /^(png|jpg|jpeg|gif|webp|bmp|ico|svg|heic|raw)$/.test(extension) ? 0
          : /^(mp4|mkv|webm|mov|avi|mp3|wav|flac|ogg|m4a)$/.test(extension) ? 1
          : /^(zip|7z|rar|gz|tar|xz|iso)$/.test(extension) ? 2
          : /^(txt|md|pdf|docx?|xlsx?|pptx?|json|js|ts|tsx|css|html|py|cs|rs|go|xml|yaml|yml|csv|log)$/.test(extension) ? 3 : 4;
        result = colors[category]; extensions.set(extension,result);
      }
      return result;
    };
    const abbreviate = (text: string, width: number) => {
      if (context.measureText(text).width <= width) return text;
      let low = 0, high = text.length;
      while (low < high) {
        const mid = Math.ceil((low+high)/2);
        if (context.measureText(text.slice(0,mid)+'…').width <= width) low = mid; else high = mid-1;
      }
      return text.slice(0,low)+'…';
    };
    const draw = (items: DiskNode[], x: number, y: number, width: number, height: number, depth: number): Scene => {
      const scene: Scene = {layout:new TreemapLayout(items,x,y,width,height),children:new Map()};
      // Batch small rectangles by color, with a bounded path rather than thousands of fill calls.
      const paths = new Map<string,{path:Path2D;count:number}>();
      scene.layout.forEach((node,x,y,width,height) => {
        const gap = Math.min(width,height) >= 12 ? 1.5 : Math.min(width,height) >= 4 ? .15 : 0;
        const tx = x+gap, ty = y+gap, tw = Math.max(0,width-2*gap), th = Math.max(0,height-2*gap), fill = color(node,depth);
        if (tw < 12 || th < 12) {
          let batch = paths.get(fill);
          if (!batch) { batch = {path:new Path2D(),count:0}; paths.set(fill,batch); }
          batch.path.rect(tx,ty,tw,th);
          if (++batch.count === 2048) { context.fillStyle = fill; context.fill(batch.path); batch.path = new Path2D(); batch.count = 0; }
          return;
        }
        context.fillStyle = fill; context.beginPath(); context.roundRect(tx,ty,tw,th,Math.min(5,tw/2,th/2)); context.fill();
        const nested = node.directory && depth+1 < depthLimit && tw > 95 && th > 85 && node.children.some(n => n.size > 0);
        if (tw > 44 && th > 23) {
          context.fillStyle = this.dark ? '#edf2f7' : '#344359';
          context.font = `${depth === 0 ? 550 : 450} 12px ${font}`;
          context.fillText(abbreviate(node.name,tw-16),tx+8,ty+18);
          if (!nested && th > 49 && tw > 63) {
            context.font = `11px ${font}`; context.fillStyle = this.dark ? '#c1ccd8' : '#526079'; context.fillText(size(node.size),tx+8,ty+36);
          }
        }
        if (nested) scene.children.set(node,draw(node.children,tx+4,ty+28,tw-8,th-32,depth+1));
      });
      for (const [fill,batch] of paths) if (batch.count) { context.fillStyle = fill; context.fill(batch.path); }
      return scene;
    };
    this.scene = draw(nodes,3,3,width-6,height-6,0);
  }

  hit(x: number, y: number): Tile | undefined {
    let scene = this.scene, tile: Tile | undefined;
    while (scene) {
      const next = scene.layout.hit(x,y);
      if (!next) break;
      tile = next; scene = scene.children.get(next.node);
    }
    return tile;
  }

  selection(selected?: DiskNode, hovered?: Tile) {
    if (selected !== this.selected) {
      this.selected = selected;
      this.selectedTile = selected && this.scene ? this.find(this.scene,selected) : undefined;
    }
    const context = this.overlayContext;
    for (const tile of this.outlined) context.clearRect(tile.x-3,tile.y-3,tile.width+6,tile.height+6);
    this.outlined = [];
    for (const [tile,stroke] of [[hovered,this.dark ? '#e1ebf7' : '#ffffff'],[this.selectedTile,this.dark ? '#93c5fd' : '#3f5d89']] as const) {
      if (!tile || tile === hovered && tile.node.path === this.selectedTile?.node.path) continue;
      const small = Math.min(tile.width,tile.height) < 8, inset = small ? 0 : 2.5;
      context.strokeStyle = stroke; context.lineWidth = small ? 1 : 2;
      context.beginPath(); context.roundRect(tile.x+inset,tile.y+inset,Math.max(.2,tile.width-2*inset),Math.max(.2,tile.height-2*inset),small ? 0 : 3); context.stroke();
      this.outlined.push(tile);
    }
  }

  release() {
    this.scene = undefined; this.selected = undefined; this.selectedTile = undefined; this.outlined = [];
    // Hidden pages release the two pixel buffers as well as the layout references.
    this.canvas.width = this.overlay.width = this.canvas.height = this.overlay.height = 1;
  }

  private find(scene: Scene, node: DiskNode): Tile | undefined {
    const tile = scene.layout.find(node);
    if (tile) return tile;
    for (const child of scene.children.values()) { const nested = this.find(child,node); if (nested) return nested; }
  }
}
