const maximumHeight=16_000_000;
export function virtualRange(count:number,height:number,rowHeight:number,top:number,overscan=8){
 const total=count*rowHeight,physical=Math.min(maximumHeight,total),last=Math.max(0,total-height),physicalLast=Math.max(0,physical-height);top=Math.max(0,Math.min(physicalLast,top));
 // Chromium may round the final scroll position by a device pixel. Scaled lists
 // must still align the last row instead of multiplying that rounding error.
 const logical=physicalLast?(total>maximumHeight&&physicalLast-top<=1?last:top*last/physicalLast):0;
 const start=Math.max(0,Math.floor(logical/rowHeight)-overscan),end=Math.min(count,Math.ceil((logical+height)/rowHeight)+overscan);
 return{start,end,physical,offset:top+start*rowHeight-logical,logical,last,physicalLast};
}
export function virtualScrollTop(count:number,height:number,rowHeight:number,position:number,offset=0){
 const range=virtualRange(count,height,rowHeight,0),logical=Math.max(0,Math.min(range.last,position*rowHeight+offset));
 return range.last?logical*range.physicalLast/range.last:0;
}

/** One scroll surface, bounded visible rows, and scaled height for very large lists. */
export class VirtualRows {
 readonly items=document.createElement('div');
 private space=document.createElement('div');private layer=document.createElement('div');private frame=0;private disposed=false;private active=true;private viewportHeight=0;private resize:ResizeObserver;private rows=new Map<number,HTMLElement>();
 constructor(readonly scroll:HTMLElement,private count:()=>number,private row:(position:number,previous?:HTMLElement)=>HTMLElement,private height=36,private painted=()=>{}){
  this.space.className='virtual-row-space';this.items.className='virtual-row-items';this.layer.className='virtual-row-layer';Object.assign(this.layer.style,{position:'sticky',top:'0',left:'0',overflow:'hidden'});this.layer.append(this.items);this.space.append(this.layer);scroll.append(this.space);
  scroll.addEventListener('scroll',this.refresh,{passive:true});this.resize=new ResizeObserver(this.refresh);this.resize.observe(scroll);this.refresh();
 }
 readonly refresh=()=>{if(this.disposed||!this.active||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.paint();});};
 setActive(active:boolean){if(this.active===active)return;this.active=active;if(active)this.refresh();else{cancelAnimationFrame(this.frame);this.frame=0;}}
 reset(){cancelAnimationFrame(this.frame);this.frame=0;this.rows.clear();this.items.replaceChildren();this.space.style.height='0px';this.layer.style.height='0px';this.scroll.scrollTop=0;this.refresh();}
 location(){const range=virtualRange(this.count(),this.scroll.clientHeight||this.viewportHeight,this.height,this.scroll.scrollTop),position=Math.floor(range.logical/this.height);return{position,offset:range.logical-position*this.height};}
 anchor(position:number,offset=0){const height=this.scroll.clientHeight||this.viewportHeight;this.space.style.height=virtualRange(this.count(),height,this.height,0).physical+'px';this.scroll.scrollTop=virtualScrollTop(this.count(),height,this.height,position,offset);this.refresh();}
 private paint(){
  if(!this.active||!this.scroll.clientHeight)return;this.viewportHeight=this.scroll.clientHeight;
  const range=virtualRange(this.count(),this.scroll.clientHeight,this.height,this.scroll.scrollTop);
  this.space.style.height=range.physical+'px';
  this.layer.style.height=Math.min(this.scroll.clientHeight,range.physical)+'px';
  for(const [position,row]of this.rows)if(position<range.start||position>=range.end){row.remove();this.rows.delete(position);}
  let cursor=this.items.firstElementChild;
  for(let position=range.start;position<range.end;position++){
   const previous=this.rows.get(position),row=this.row(position,previous);row.style.height=this.height+'px';
   if(previous&&previous!==row){previous.replaceWith(row);if(cursor===previous)cursor=row;}
   this.rows.set(position,row);if(cursor!==row)this.items.insertBefore(row,cursor);cursor=row.nextElementSibling;
  }
  this.items.style.transform=`translateY(${range.offset-this.scroll.scrollTop}px)`;
  this.painted();
 }
 reveal(position:number){
  const range=virtualRange(this.count(),this.scroll.clientHeight,this.height,this.scroll.scrollTop),top=position*this.height,bottom=top+this.height;
  let logical=range.logical;if(top<logical)logical=top;else if(bottom>logical+this.scroll.clientHeight)logical=bottom-this.scroll.clientHeight;
  this.space.style.height=range.physical+'px';this.scroll.scrollTop=range.last?logical*range.physicalLast/range.last:0;this.refresh();
 }
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();this.scroll.removeEventListener('scroll',this.refresh);this.rows.clear();this.space.remove();}
}
