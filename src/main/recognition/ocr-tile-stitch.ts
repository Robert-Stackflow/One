import {textBounds,type TextToken} from '../../shared/recognition/text-document';
import type {OCRWord} from '../../shared/recognition/ocr';
export interface StitchFragment {word:OCRWord;tokens:TextToken[];tiles:Set<number>;clippedLeft:boolean;clippedRight:boolean}
function spans(value:StitchFragment){
 let cursor=0;const output:{token:TextToken;start:number;end:number}[]=[];
 for(const token of value.tokens){
  if(token.geometry!=='ctc'||Math.abs(token.quad[1].x-token.quad[0].x)<Math.abs(token.quad[1].y-token.quad[0].y)*2)return;
  const start=value.word.text.indexOf(token.text,cursor);if(start<0||!/^[\s]*$/.test(value.word.text.slice(cursor,start)))return;
  output.push({token,start,end:start+token.text.length});cursor=start+token.text.length;
 }
 return /^[\s]*$/.test(value.word.text.slice(cursor))?output:undefined;
}
function agrees(a:TextToken,b:TextToken){
 if(a.text!==b.text)return false;
 const x=textBounds(a.quad),y=textBounds(b.quad);
 return Math.abs(x.x+x.width/2-y.x-y.width/2)<=Math.max(3,Math.min(x.width,y.width))&&Math.abs(x.y+x.height/2-y.y-y.height/2)<=Math.max(3,Math.min(x.height,y.height)*.5);
}
/** Facing crop edges join only when independently aligned CTC characters agree in source space.
 * Whitespace comes from observed text. At most one glyph touching each crop edge may be replaced. */
export function stitchOCRRow<T extends StitchFragment>(items:readonly T[]):T[]{
 const output:T[]=[];
 for(const right of items){
  const left=output.at(-1);if(!left||!left.clippedRight||!right.clippedLeft||[...right.tiles].some(tile=>left.tiles.has(tile))){output.push(right);continue;}
  const a=left.word,b=right.word,overlap=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
  if(a.x>=b.x||a.x+a.width>=b.x+b.width||overlap<=0||a.text.length>2048||b.text.length>2048){output.push(right);continue;}
  const l=spans(left),r=spans(right);if(!l?.length||!r?.length){output.push(right);continue;}
  const lastBox=textBounds(l.at(-1)!.token.quad),firstBox=textBounds(r[0].token.quad);
  const trimLeft=a.x+a.width-lastBox.x-lastBox.width<=4?1:0,trimRight=firstBox.x-b.x<=4?1:0;
  let best:{leftEnd:number;rightNext:number;count:number}|undefined;
  for(let trim=0;trim<=trimLeft;trim++)for(let skip=0;skip<=trimRight;skip++){
   const end=l.length-trim,max=Math.min(end,r.length-skip-1,256);
   for(let count=max;count>=3;count--){
    if(best&&count<=best.count)break;
    const shared=l.slice(end-count,end),other=r.slice(skip,skip+count);
    if(shared.map(part=>part.token.text).join('').replace(/\s/gu,'').length<3||!shared.every((part,index)=>agrees(part.token,other[index].token)))continue;
    const drift=shared.reduce((sum,part,index)=>{const a=textBounds(part.token.quad),b=textBounds(other[index].token.quad);return sum+Math.abs(a.x+a.width/2-b.x-b.width/2)/Math.max(1,Math.min(a.width,b.width));},0)/count;if(drift>.5)continue;
    best={leftEnd:end,rightNext:skip+count,count};break;
   }
  }
  if(!best){output.push(right);continue;}
  const leftEnd=l[best.leftEnd-1].end,rightEnd=r[best.rightNext-1].end,rightNext=r[best.rightNext].start;
  const separator=b.text.slice(rightEnd,rightNext)||a.text.slice(leftEnd,l[best.leftEnd]?.start??a.text.length),x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
  output[output.length-1]={...left,word:{...a,text:a.text.slice(0,leftEnd)+separator+b.text.slice(rightNext),x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y,confidence:Math.min(a.confidence,b.confidence)},
   tokens:[...left.tokens.slice(0,best.leftEnd),...right.tokens.slice(best.rightNext)],tiles:new Set([...left.tiles,...right.tiles]),clippedRight:right.clippedRight};
 }
 return output;
}
