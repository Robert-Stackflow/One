const maximumHeight=16_000_000;
export function virtualRange(count:number,height:number,rowHeight:number,top:number,overscan=8){
 const total=count*rowHeight,physical=Math.min(maximumHeight,total),last=Math.max(0,total-height),physicalLast=Math.max(0,physical-height);top=Math.max(0,Math.min(physicalLast,top));const logical=physicalLast?top*last/physicalLast:0;
 const start=Math.max(0,Math.floor(logical/rowHeight)-overscan),end=Math.min(count,Math.ceil((logical+height)/rowHeight)+overscan);
 return{start,end,physical,offset:top+start*rowHeight-logical,logical,last,physicalLast};
}

/** One scroll surface, bounded visible rows, and scaled height for very large lists. */
export class VirtualRows {
 readonly items=document.createElement('div');
 private space=document.createElement('div');private layer=document.createElement('div');private frame=0;private disposed=false;private resize:ResizeObserver;private rows=new Map<number,HTMLElement>();
 constructor(readonly scroll:HTMLElement,private count:()=>number,private row:(position:number,previous?:HTMLElement)=>HTMLElement,private height=36){
  this.space.className='virtual-row-space';this.items.className='virtual-row-items';this.layer.className='virtual-row-layer';Object.assign(this.layer.style,{position:'sticky',top:'0',left:'0',overflow:'hidden'});this.layer.append(this.items);this.space.append(this.layer);scroll.append(this.space);
  scroll.addEventListener('scroll',this.refresh,{passive:true});this.resize=new ResizeObserver(this.refresh);this.resize.observe(scroll);this.refresh();
 }
 readonly refresh=()=>{if(this.disposed||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.paint();});};
 private paint(){
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
 }
 reveal(position:number){
  const range=virtualRange(this.count(),this.scroll.clientHeight,this.height,this.scroll.scrollTop),top=position*this.height,bottom=top+this.height;
  let logical=range.logical;if(top<logical)logical=top;else if(bottom>logical+this.scroll.clientHeight)logical=bottom-this.scroll.clientHeight;
  this.space.style.height=range.physical+'px';this.scroll.scrollTop=range.last?logical*range.physicalLast/range.last:0;this.refresh();
 }
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();this.scroll.removeEventListener('scroll',this.refresh);this.rows.clear();this.space.remove();}
}
