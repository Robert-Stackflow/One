import { imageDimensions } from './image-limits';
import { scrollOptions,ScrollCaptureLimit, type ScrollOptions, type ScrollMatch } from './scroll-capture';
import {scrollSearchCandidates,scrollLocallyConsistent} from './scroll-search';
import {detectScrollFixedEdges,type FixedEdges} from './scroll-fixed';
export interface PixelFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}
export interface ScrollStripStorage {
  put(pixels:Uint8Array):number;
  read(id:number):Uint8Array;
  rows(id:number,stride:number,indices:number[]):Uint8Array;
  remove(id:number):void;
  reset():void;
  readonly bytes:number;
}
interface Strip {
  pixels: Uint8Array|number;
  rows: number;
  previous?: Uint8Array;
  rowStart?:number;
}
const BUDGET = 256 * 1024 * 1024;
/** Original BGRA bytes, append-only strips, bounded undo and explicit uncertain joins.
 * Horizontal capture uses the same matching algorithm on a transposed view.
 * This module runs in a worker, never on Electron's main/renderer thread. */
export class ScrollStitch {
  constructor(private storage?:ScrollStripStorage,private autoFixed=false){}
  private fixed?:FixedEdges&{header:Uint8Array;footer:Uint8Array};
  private fixedAttempts=0;
  private strips: Strip[] = [];
  private previous?: Uint8Array;
  private candidate?: Uint8Array;
  private axis = 0;
  private cross = 0;
  private rows = 0;
  private options?: ScrollOptions;
  private source?: { width: number; height: number };
  private count = 0;
  private offset = 0;
  private match: ScrollMatch = 'first';
  configure(options: ScrollOptions, source: { width: number; height: number }) {
    imageDimensions(source.width, source.height);
    if (source.width * source.height > 10000000)
      throw Error('长截图单帧最多 1,000 万像素，请缩小选区');
    this.options = scrollOptions(options, source.width, source.height);
    this.source = source;
    this.storage?.reset();
    this.strips = [];
    this.fixed=undefined;this.fixedAttempts=0;
    this.previous = this.candidate = undefined;
    this.axis = this.cross = this.rows = this.count = this.offset = 0;
    this.match = 'first';
    return this.status();
  }
  private normalize(frame: PixelFrame) {
    if (
      !this.options ||
      !this.source ||
      frame.width !== this.source.width ||
      frame.height !== this.source.height ||
      frame.pixels.byteLength !== frame.width * frame.height * 4
    )
      throw Error('采集帧尺寸已改变');
    const vertical = this.options.axis === 'vertical';
    this.axis =
      (vertical ? frame.height : frame.width) - this.options.trimStart - this.options.trimEnd;
    this.cross = vertical ? frame.width : frame.height;
    const pixels = new Uint8Array(this.axis * this.cross * 4);
    if (vertical)
      pixels.set(
        frame.pixels.subarray(
          this.options.trimStart * this.cross * 4,
          (frame.height - this.options.trimEnd) * this.cross * 4,
        ),
      );
    else
      for (let y = 0; y < this.axis; y++)
        for (let x = 0; x < this.cross; x++) {
          const from = (x * frame.width + y + this.options.trimStart) * 4;
          pixels.set(frame.pixels.subarray(from, from + 4), (y * this.cross + x) * 4);
        }
    return pixels;
  }
  private score(a: Uint8Array, b: Uint8Array, shift: number, precise = false) {
    const start = Math.max(0, -shift),
      end = Math.min(this.axis, this.axis - shift),
      left = this.options!.ignoreStart,
      right = this.cross - this.options!.ignoreEnd,
      stepY = Math.max(1, Math.floor((end - start) / (precise ? 96 : 22))),
      stepX = Math.max(1, Math.floor((right - left) / (precise ? 30 : 12)));
    // Per-column scores prevent one changing caret/animation/scrollbar from
    // dominating. Never discard more than 10% of the sampled width.
    const columns: number[] = [];
    for (let x = left; x < right; x += stepX) {
      let sum = 0,
        n = 0;
      for (let y = start; y < end; y += stepY) {
        const i = ((y + shift) * this.cross + x) * 4,
          j = (y * this.cross + x) * 4;
        for (let c = 0; c < 3; c++) {
          sum += Math.abs(a[i + c] - b[j + c]);
          n++;
        }
      }
      columns.push(sum / n);
    }
    columns.sort((x, y) => x - y);
    const keep = Math.ceil(columns.length * 0.9);
    return columns.slice(0, keep).reduce((s, v) => s + v, 0) / keep;
  }
  private sameBody(a:Uint8Array,b:Uint8Array){
    const first=Buffer.from(a.buffer,a.byteOffset,a.byteLength),second=Buffer.from(b.buffer,b.byteOffset,b.byteLength),left=this.options!.ignoreStart,right=this.cross-this.options!.ignoreEnd;
    if(left===0&&right===this.cross)return first.equals(second);
    for(let row=0;row<this.axis;row++){const start=(row*this.cross+left)*4,end=(row*this.cross+right)*4;if(!first.subarray(start,end).equals(second.subarray(start,end)))return false;}
    return true;
  }
  private retainEdges(edges:FixedEdges){
    const old=this.previous!,fullAxis=this.axis,start=edges.start*this.cross*4,end=(fullAxis-edges.end)*this.cross*4;
    this.fixed={...edges,header:old.slice(0,start),footer:old.slice(end)};
    this.options={...this.options!,trimStart:this.options!.trimStart+edges.start,trimEnd:this.options!.trimEnd+edges.end};
    this.axis=fullAxis-edges.start-edges.end;this.rows=this.axis;this.strips[0].rows=this.axis;this.strips[0].rowStart=edges.start;this.previous=old.slice(start,end);
  }
  sample(frame: PixelFrame) {
    if (this.candidate) throw Error('请先处理上一帧的拼接位置');
    let pixels = this.normalize(frame);
    if (!this.previous) {
      const stored=this.storage?this.storage.put(pixels):pixels;
      this.previous = pixels;
      this.strips = [{ pixels:stored, rows: this.axis }];
      this.rows = this.axis;
      this.count = 1;
      this.match = 'first';
      if(this.options!.retainStart||this.options!.retainEnd)this.retainEdges({start:this.options!.retainStart||0,end:this.options!.retainEnd||0});
      return this.status();
    }
    if (this.count >= 200) throw new ScrollCaptureLimit('本次长截图已达到 200 帧，请确认已有结果');
    if (this.sameBody(this.previous,pixels)) {
      this.match = 'unchanged';
      this.offset = 0;
      return this.status();
    }
    if(this.autoFixed&&this.options!.autoFixed!==false&&this.count===1&&!this.fixed&&this.fixedAttempts<3&&!this.options!.trimStart&&!this.options!.trimEnd){
      this.fixedAttempts++;const edges=detectScrollFixedEdges(this.previous,pixels,this.axis,this.cross,this.options!.ignoreStart,this.cross-this.options!.ignoreEnd);
      if(edges){
        pixels=pixels.slice(edges.start*this.cross*4,(this.axis-edges.end)*this.cross*4);this.retainEdges(edges);
      }
    }
    const guesses: { shift: number; score: number }[] = [{shift:0,score:this.score(this.previous,pixels,0)}];
    for (const shift of scrollSearchCandidates(this.previous,pixels,this.axis,this.cross,this.options!.ignoreStart,this.cross-this.options!.ignoreEnd)) {
      guesses.push({ shift, score: this.score(this.previous, pixels, shift) });
    }
    guesses.sort((a, b) => a.score - b.score);
    // Refine separated hypotheses; adjacent shifts belong to the same peak.
    const refined: typeof guesses = [];
    for (const guess of guesses) {
      if (refined.some((v) => Math.abs(v.shift - guess.shift) <= 3)) continue;
      refined.push({
        shift: guess.shift,
        score: this.score(this.previous, pixels, guess.shift, true),
      });
      if (refined.length === 12) break;
    }
    refined.sort((a, b) => a.score - b.score);
    const best = refined[0],
      runner = refined[1];
    this.offset = Math.max(1, best.shift);
    const confident =
      best.score <= 3 &&
      (!runner || runner.score > best.score + 2 || (best.score < 0.15 && runner.score > 0.5))&&
      scrollLocallyConsistent(this.previous,pixels,this.axis,this.cross,this.options!.ignoreStart,this.cross-this.options!.ignoreEnd,best.shift);
    if (!confident) {
      this.candidate = pixels;
      this.match = 'ambiguous';
      return this.status();
    }
    if(best.shift===0){this.match='unchanged';this.offset=0;return this.status();}
    if (best.shift < 0) {
      this.offset=best.shift;
      this.match = 'backwards';
      return this.status();
    }
    return this.append(pixels, best.shift);
  }
  join(offset: number) {
    if (!this.candidate) throw Error('没有待确认的采集帧');
    if (!Number.isSafeInteger(offset) || offset < 1 || offset > this.axis - 32)
      throw Error('拼接位移无效');
    return this.append(this.candidate, offset);
  }
  private append(pixels: Uint8Array, shift: number) {
    const rows = this.rows + shift;
    const totalRows=rows+(this.fixed?.start||0)+(this.fixed?.end||0);
    try{imageDimensions(
      this.options!.axis === 'vertical' ? this.cross : totalRows,
      this.options!.axis === 'vertical' ? totalRows : this.cross,
    );}catch(error){throw new ScrollCaptureLimit((error as Error).message+'。已有内容已保留。');}
    const tail = this.storage?pixels.subarray((this.axis-shift)*this.cross*4):pixels.slice((this.axis - shift) * this.cross * 4),stored=this.storage?this.storage.put(tail):tail;
    this.strips.push({ pixels: stored, rows: shift, previous: this.previous });
    this.rows = rows;
    this.previous = pixels;
    this.candidate = undefined;
    this.count++;
    this.offset = shift;
    this.match = 'accepted';
    // Keep up to eight previous frames when the memory budget permits it.
    const start = Math.max(1, this.strips.length - 8);
    for (let i = 1; i < start; i++) this.strips[i].previous = undefined;
    let bytes = this.strips.reduce(
      (s, p) => s + (typeof p.pixels==='number'?0:p.pixels.byteLength) + (p.previous?.byteLength || 0),
      pixels.byteLength+(this.fixed?.header.byteLength||0)+(this.fixed?.footer.byteLength||0),
    );
    for (let i = 1; bytes > (this.storage?96*1024*1024:BUDGET) && i < this.strips.length - 1; i++) {
      bytes -= this.strips[i].previous?.byteLength || 0;
      this.strips[i].previous = undefined;
    }
    return this.status();
  }
  discard() {
    this.candidate?.fill(0);
    this.candidate = undefined;
    return this.status();
  }
  undo() {
    const last = this.strips.at(-1);
    if (!last?.previous) throw Error('没有可撤销的拼接');
    if(typeof last.pixels==='number')this.storage!.remove(last.pixels);
    this.strips.pop();
    this.previous = last.previous;
    this.rows -= last.rows;
    this.candidate = undefined;
    this.count--;
    this.offset = 0;
    this.match = 'first';
    return this.status();
  }
  status() {
    const vertical = this.options?.axis !== 'horizontal';
    return {
      width: vertical ? this.cross : this.rows+(this.fixed?.start||0)+(this.fixed?.end||0),
      height: vertical ? this.rows+(this.fixed?.start||0)+(this.fixed?.end||0) : this.cross,
      count: this.count,
      undo: !!this.strips.at(-1)?.previous,
      pending: !!this.candidate,
      offset: this.offset,
      match: this.match,
      fixed:this.fixed?{start:this.fixed.start,end:this.fixed.end}:undefined,
    };
  }
  output(): PixelFrame {
    if (!this.previous) throw Error('还没有采集图像');
    const { width, height } = this.status(),
      pixels = new Uint8Array(width * height * 4);
    let offset = this.fixed?.start||0;
    const copyRows=(bytes:Uint8Array,rows:number)=>{if(this.options!.axis==='vertical')pixels.set(bytes,offset*this.cross*4);else for(let row=0;row<rows;row++)for(let x=0;x<this.cross;x++)pixels.set(bytes.subarray((row*this.cross+x)*4,(row*this.cross+x)*4+4),(x*width+offset+row)*4);offset+=rows;};
    if(this.fixed){offset=0;copyRows(this.fixed.header,this.fixed.start);}
    for (const strip of this.strips) {
      const bytes=typeof strip.pixels==='number'?this.storage!.read(strip.pixels):strip.pixels;
      copyRows(bytes.subarray((strip.rowStart||0)*this.cross*4,((strip.rowStart||0)+strip.rows)*this.cross*4),strip.rows);
      if(typeof strip.pixels==='number')bytes.fill(0);
    }
    if(this.fixed)copyRows(this.fixed.footer,this.fixed.end);
    return { width, height, pixels };
  }
  preview(): PixelFrame | null {
    if (!this.previous) return null;
    const size = this.status(),
      scale = Math.min(1, 300 / size.width, 700 / size.height),
      width = Math.max(1, Math.round(size.width * scale)),
      height = Math.max(1, Math.round(size.height * scale)),
      pixels = new Uint8Array(width * height * 4);
    const previewStrips:Strip[]=[...(this.fixed?.start?[{pixels:this.fixed.header,rows:this.fixed.start}]:[]),...this.strips,...(this.fixed?.end?[{pixels:this.fixed.footer,rows:this.fixed.end}]:[])];
    const limits = previewStrips
      .map((s) => s.rows)
      .reduce<number[]>((a, n) => [...a, (a.at(-1) || 0) + n], []);
    const vertical=this.options!.axis==='vertical',requests=new Map<number,{out:number;row:number}[]>();
    for(let out=0;out<(vertical?height:width);out++){
      const axis=Math.min((vertical?size.height:size.width)-1,Math.floor(out/scale)),index=limits.findIndex(n=>axis<n),list=requests.get(index)||[];list.push({out,row:axis-(limits[index-1]||0)});requests.set(index,list);
    }
    for(const [index,list] of requests){
      const strip=previewStrips[index],stored=typeof strip.pixels==='number',bytes=stored?this.storage!.rows(strip.pixels as number,this.cross*4,list.map(item=>item.row+(strip.rowStart||0))):strip.pixels as Uint8Array;
      for(let row=0;row<list.length;row++)for(let cross=0;cross<(vertical?width:height);cross++){
        const at=((stored?row:list[row].row+(strip.rowStart||0))*this.cross+Math.min(this.cross-1,Math.floor(cross/scale)))*4,to=(vertical?list[row].out*width+cross:cross*width+list[row].out)*4;pixels.set(bytes.subarray(at,at+4),to);
      }
      if(stored)bytes.fill(0);
    }
    return { width, height, pixels };
  }
  storageStats(){const buffers=new Set<Uint8Array>();if(this.previous)buffers.add(this.previous);if(this.candidate)buffers.add(this.candidate);if(this.fixed){buffers.add(this.fixed.header);buffers.add(this.fixed.footer);}for(const strip of this.strips){if(typeof strip.pixels!=='number')buffers.add(strip.pixels);if(strip.previous)buffers.add(strip.previous);}return {residentBytes:[...buffers].reduce((sum,bytes)=>sum+bytes.byteLength,0),diskBytes:this.storage?.bytes||0,strips:this.strips.length};}
}
