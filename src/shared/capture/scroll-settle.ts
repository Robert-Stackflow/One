import { imageDimensions } from './image-limits';
import { scrollOptions, type ScrollOptions, type ScrollDynamicRegion } from './scroll-capture';
import type { PixelFrame } from './scroll-stitch';

/** Compare the same body coordinates across time, before any frame reaches the
 * stitch model. A small changing column (caret/scrollbar) is tolerated; smooth
 * scrolling and widespread animation keep resetting the quiet interval. */
export class ScrollSettle {
  private options: ScrollOptions;
  private reference?: Uint8Array;
  private since = 0;
  private samples = 0;
  private last = -1;
  private columns: number;
  private rows: number;
  private width: number;
  private height: number;
  private fixedStart=0;
  private fixedEnd=0;
  private recent?:Uint8Array;
  private hits=new Uint8Array(16*24);
  private dynamic:ScrollDynamicRegion[]=[];
  constructor(options: ScrollOptions, source: { width: number; height: number }) {
    imageDimensions(source.width, source.height);
    this.options = scrollOptions(options, source.width, source.height);
    this.width = source.width;
    this.height = source.height;
    const vertical = options.axis === 'vertical';
    this.columns = Math.min(
      48,
      (vertical ? source.width : source.height) - options.ignoreStart - options.ignoreEnd,
    );
    this.rows = Math.min(
      96,
      (vertical ? source.height : source.width) - options.trimStart - options.trimEnd,
    );
    if(options.retainStart||options.retainEnd)this.excludeFixed(options.retainStart||0,options.retainEnd||0);
  }
  excludeFixed(start:number,end:number){
    if(start===this.fixedStart&&end===this.fixedEnd)return;
    this.options=scrollOptions({...this.options,retainStart:0,retainEnd:0,trimStart:this.options.trimStart-this.fixedStart+start,trimEnd:this.options.trimEnd-this.fixedEnd+end},this.width,this.height);
    this.fixedStart=start;this.fixedEnd=end;
    this.rows=Math.min(96,(this.options.axis==='vertical'?this.height:this.width)-this.options.trimStart-this.options.trimEnd);
    this.reset();
  }
  reset() {
    this.reference = undefined;
    this.recent=undefined;this.hits.fill(0);this.dynamic=[];
    this.samples = 0;
    this.last = -1;
  }
  dynamicRegions(){return this.dynamic.map(region=>({...region}));}
  private bounds(cells:number[]){
    if(!cells.length)return;
    const xs=cells.map(cell=>cell%16),ys=cells.map(cell=>Math.floor(cell/16)),left=Math.min(...xs),right=Math.max(...xs)+1,top=Math.min(...ys),bottom=Math.max(...ys)+1;
    if((right-left)*(bottom-top)>16*24*.06||right-left>8||bottom-top>12)return;
    return {left,right,top,bottom};
  }
  observe(frame: PixelFrame, now: number,quietMs=280): boolean {
    if (
      frame.width !== this.width ||
      frame.height !== this.height ||
      frame.pixels.byteLength !== this.width * this.height * 4
    )
      throw Error('采集帧尺寸已改变');
    if (!Number.isFinite(now) || now < 0 || now < this.last) throw Error('采集时间无效');
    const vertical = this.options.axis === 'vertical',
      axis = (vertical ? this.height : this.width) - this.options.trimStart - this.options.trimEnd,
      cross =
        (vertical ? this.width : this.height) - this.options.ignoreStart - this.options.ignoreEnd,
      signature = new Uint8Array(this.columns * this.rows * 3);
    for (let x = 0; x < this.columns; x++)
      for (let y = 0; y < this.rows; y++) {
        const a = this.options.trimStart + Math.floor((y * (axis - 1)) / (this.rows - 1)),
          c = this.options.ignoreStart + Math.floor((x * (cross - 1)) / (this.columns - 1)),
          from = (vertical ? a * this.width + c : c * this.width + a) * 4,
          to = (x * this.rows + y) * 3;
        signature.set(frame.pixels.subarray(from, from + 3), to);
      }
    const cell=(x:number,y:number)=>Math.min(15,Math.floor(x*16/this.columns))+Math.min(23,Math.floor(y*24/this.rows))*16;
    const calmOutside=(box:NonNullable<ReturnType<ScrollSettle['bounds']>>)=>{
      let error=0,count=0;
      for(let x=0;x<this.columns;x++)for(let y=0;y<this.rows;y++){
        const id=cell(x,y),cx=id%16,cy=Math.floor(id/16);if(cx>=box.left&&cx<box.right&&cy>=box.top&&cy<box.bottom)continue;
        const at=(x*this.rows+y)*3;for(let c=0;c<3;c++){error+=Math.abs(this.reference![at+c]-signature[at+c]);count++;}
      }
      return count>0&&error/count<.4;
    };
    let changed = !this.reference;
    if (this.reference) {
      const errors: number[] = [];
      for (let x = 0; x < this.columns; x++) {
        let difference = 0;
        for (let i = x * this.rows * 3; i < (x + 1) * this.rows * 3; i++)
          difference += Math.abs(this.reference[i] - signature[i]);
        errors.push(difference / (this.rows * 3));
      }
      errors.sort((a, b) => a - b);
      const keep = Math.ceil(errors.length * 0.9);
      changed = errors.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep >= 0.4;
    }
    let local=false,learning=false;
    if(this.reference&&this.recent){
      const differences=new Float32Array(16*24),counts=new Uint16Array(16*24);
      for(let x=0;x<this.columns;x++)for(let y=0;y<this.rows;y++){const id=cell(x,y),at=(x*this.rows+y)*3;for(let c=0;c<3;c++){differences[id]+=Math.abs(this.recent[at+c]-signature[at+c]);counts[id]++;}}
      const moving:number[]=[];for(let id=0;id<differences.length;id++)if(counts[id]&&differences[id]/counts[id]>=3)moving.push(id);
      const movement=this.bounds(moving);
      if(movement){for(const id of moving)this.hits[id]=Math.min(255,this.hits[id]+1);}
      else if(moving.length)this.hits.fill(0);
      const repeated=this.bounds([...this.hits.keys()].filter(id=>this.hits[id]>=2));
      if(repeated&&calmOutside(repeated)){
        const start=this.options.trimStart+Math.floor(repeated.top*axis/24),end=this.options.trimStart+Math.ceil(repeated.bottom*axis/24),left=this.options.ignoreStart+Math.floor(repeated.left*cross/16),right=this.options.ignoreStart+Math.ceil(repeated.right*cross/16);
        this.dynamic=[vertical?{x:left,y:start,width:right-left,height:end-start}:{x:start,y:left,width:end-start,height:right-left}];local=true;
      }else{
        this.dynamic=[];const occupied=this.bounds([...this.hits.keys()].filter(id=>this.hits[id]));
        learning=!!movement&&!!occupied&&calmOutside(occupied);
      }
    }
    this.recent=signature;
    this.last = now;
    if (changed&&!local&&!learning) {
      this.reference = signature;
      this.hits.fill(0);this.dynamic=[];
      this.since = now;
      this.samples = 1;
      return false;
    }
    // Keep the first signature of the interval, so gradual drift cannot hide
    // behind a series of individually small changes.
    this.samples++;
    if(learning&&changed)return false;
    return this.samples >= (local?4:3) && now - this.since >= (local?420:quietMs);
  }
}
