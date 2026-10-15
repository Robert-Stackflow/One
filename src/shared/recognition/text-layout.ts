import type {OCRWord} from './ocr';
import type {TextQuad} from './text-document';
export interface TextLayoutFragment {x:number;y:number;width:number;height:number;text:string;quad?:TextQuad}
interface Projected<T> {item:T;x:number;y:number;width:number;height:number;angle:number}
export const TEXT_LAYOUT_VERSION='xycut-1';
export interface TextReadingLayout<T> {blocks:T[][][];columns:boolean}
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]||1;
function bounds<T>(items:Projected<T>[]){
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const item of items){x=Math.min(x,item.x);y=Math.min(y,item.y);right=Math.max(right,item.x+item.width);bottom=Math.max(bottom,item.y+item.height);}
  return {x,y,width:right-x,height:bottom-y};
}
function projectedRows<T>(items:Projected<T>[]):Projected<T>[][]{
  const result:Projected<T>[][]=[];let active:Projected<T>[][]=[];
  for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)){
    active=active.filter(row=>row[0].y+row[0].height>=item.y);
    const row=active.find(row=>{const first=row[0],overlap=Math.min(first.y+first.height,item.y+item.height)-Math.max(first.y,item.y);
      return Math.abs(Math.cos(first.angle-item.angle))>.99&&Math.abs(first.y+first.height/2-item.y-item.height/2)<Math.min(first.height,item.height)*.5&&overlap>Math.min(first.height,item.height)*.5;});
    if(row)row.push(item);else{const next=[item];result.push(next);active.push(next);}
  }
  return result.map(row=>row.sort((a,b)=>a.x-b.x));
}
function rows<T>(items:Projected<T>[]):T[][]{return projectedRows(items).map(row=>row.map(item=>item.item));}
function gaps<T>(items:Projected<T>[],axis:'x'|'y'){
  const dimension=axis==='x'?'width':'height',sorted=[...items].sort((a,b)=>a[axis]-b[axis]),output:{start:number;end:number;before:number}[]=[];
  let end=sorted[0][axis]+sorted[0][dimension];
  for(let i=1;i<sorted.length;i++){const start=sorted[i][axis];if(start>end)output.push({start:end,end:start,before:i});end=Math.max(end,start+sorted[i][dimension]);}
  return output;
}
/** Conservative whitespace cuts. Tables/line numbers keep row order; uncertain pages retain row grouping. */
export function textReadingLayout<T extends TextLayoutFragment>(input:readonly T[]):TextReadingLayout<T>{
  if(!input.length)return {blocks:[],columns:false};
  if(input.length>50000||input.some(item=>typeof item.text!=='string'||![item.x,item.y,item.width,item.height].every(Number.isFinite)||item.width<=0||item.height<=0))throw Error('阅读顺序区域无效');
  if(input.some(item=>item.quad&&(item.quad.length!==4||item.quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||Math.hypot(item.quad[1].x-item.quad[0].x,item.quad[1].y-item.quad[0].y)<1e-6||Math.hypot(item.quad[3].x-item.quad[0].x,item.quad[3].y-item.quad[0].y)<1e-6)))throw Error('阅读顺序四边形无效');
  const axes=input.filter(item=>item.quad).map(item=>{const [a,b,,d]=item.quad!,width=Math.hypot(b.x-a.x,b.y-a.y),height=Math.hypot(d.x-a.x,d.y-a.y);return {width,height,ux:(b.x-a.x)/width,uy:(b.y-a.y)/width};});
  const reference=axes.filter(axis=>axis.width>=axis.height&&Math.abs(axis.ux)>.7).sort((a,b)=>b.width-a.width)[0];
  const direction=reference&&reference.ux<0?-1:1,ux=(reference?.ux??1)*direction,uy=(reference?.uy??0)*direction;
  const projected:Projected<T>[]=input.map(item=>{
    const quad=item.quad||[{x:item.x,y:item.y},{x:item.x+item.width,y:item.y},{x:item.x+item.width,y:item.y+item.height},{x:item.x,y:item.y+item.height}];
    const xs=quad.map(p=>p.x*ux+p.y*uy),ys=quad.map(p=>-p.x*uy+p.y*ux),x=Math.min(...xs),y=Math.min(...ys);
    return {item,x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y,angle:Math.atan2(quad[1].y-quad[0].y,quad[1].x-quad[0].x)};
  });
  let budget=64;
  const fallback=(items:Projected<T>[]):TextReadingLayout<T>=>({blocks:[rows(items)],columns:false});
  function visit(items:Projected<T>[],depth:number):TextReadingLayout<T>{
    if(items.length<6||items.length>8192||depth>=12||budget--<=0||axes.length&&!reference)return fallback(items);
    const box=bounds(items),height=median(items.map(item=>item.height));
    const horizontal=gaps(items,'y').filter(gap=>gap.end-gap.start>=height*.4&&Math.min(gap.before,items.length-gap.before)<=Math.max(2,items.length*.18));
    // A centered/spanning header or footer stays outside the columns it introduces.
    for(const gap of horizontal.sort((a,b)=>Math.min(a.before,items.length-a.before)-Math.min(b.before,items.length-b.before)||b.end-b.start-(a.end-a.start)).slice(0,2)){
      const above=items.filter(item=>item.y+item.height<=gap.start),below=items.filter(item=>item.y>=gap.end),edge=above.length<=below.length?above:below;
      if(!edge.length||edge.length>2||!edge.some(item=>item.width>=box.width*.65||item.width>=box.width*.15&&Math.abs(item.x+item.width/2-box.x-box.width/2)<box.width*.22))continue;
      const a=visit(above,depth+1),b=visit(below,depth+1);if(a.columns||b.columns)return {blocks:[...a.blocks,...b.blocks],columns:true};
    }
    for(const gap of gaps(items,'x').filter(gap=>gap.end-gap.start>=Math.max(height*2,box.width*.035)).sort((a,b)=>(b.end-b.start)-(a.end-a.start)).slice(0,16)){
      const left=items.filter(item=>item.x+item.width<=gap.start),right=items.filter(item=>item.x>=gap.end);
      if(left.length<3||right.length<3||left.length+right.length!==items.length)continue;
      const a=bounds(left),b=bounds(right),overlap=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      if(Math.min(a.height,b.height)<height*3||overlap<Math.min(a.height,b.height)*.45||Math.min(...[left,right].map(side=>side.reduce((sum,item)=>sum+item.item.text.replace(/\s/gu,'').length,0)))<24)continue;
      const leftRows=projectedRows(left),rightRows=projectedRows(right),short=median(leftRows.map(row=>row.reduce((sum,item)=>sum+item.item.text.replace(/\s/gu,'').length,0)))<=12;
      const center=(row:Projected<T>[])=>row[0].y+row[0].height/2,rightByCenter=[...rightRows].sort((a,b)=>center(a)-center(b));
      const matched=leftRows.filter(row=>{
        const y=center(row);let lo=0,hi=rightByCenter.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(center(rightByCenter[mid])<y)lo=mid+1;else hi=mid;}
        return rightByCenter.slice(Math.max(0,lo-1),lo+2).some(other=>Math.abs(y-center(other))<Math.min(row[0].height,other[0].height)*.65);
      }).length/leftRows.length;
      const labels=leftRows.filter(row=>/[:：]\s*$/.test(row.map(item=>item.item.text).join(' '))).length>=leftRows.length*.4;
      if(labels||matched>=.75&&short&&a.width<box.width*.3)continue;
      if(leftRows.length<3||rightRows.length<3)continue;
      return {blocks:[...visit(left,depth+1).blocks,...visit(right,depth+1).blocks],columns:true};
    }
    return fallback(items);
  }
  return visit(projected,0);
}

/** Reorders associated quads/alignment data together. Uncertain layouts return the original records unchanged. */
export function orderOCRFragments<T extends {word:OCRWord;quad?:TextQuad}>(input:readonly T[]):{items:T[];columns:boolean}{
 const layout=textReadingLayout(input.map(item=>({...item.word,quad:item.quad,item})));
 if(!layout.columns)return {items:[...input],columns:false};
 let line=0;const items:T[]=[];
 layout.blocks.forEach((block,blockId)=>{for(const row of block){for(const fragment of row)items.push({...fragment.item,word:{...fragment.item.word,block:blockId,line}});line++;}});
 return {items,columns:true};
}
