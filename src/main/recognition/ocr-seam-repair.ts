import {OCR_TILE_EDGE,OCR_SEAM_REPAIRS,OCR_SEAM_PIXELS,ocrRect,type OCRRect,type OCRTile} from '../../shared/recognition/ocr-tiles';
import {type TextToken} from '../../shared/recognition/text-document';
import type {OCRWord} from '../../shared/recognition/ocr';
import type {OCRTileResult} from './ocr-tile-merge';
import {stitchOCRRow,type StitchFragment} from './ocr-tile-stitch';
export {OCR_SEAM_REPAIRS,OCR_SEAM_PIXELS} from '../../shared/recognition/ocr-tiles';
export interface OCRSeamRepair {tile:OCRTile;target:OCRRect;sources:{tile:number;word:number}[]}
interface Edge extends StitchFragment {source:{tile:number;word:number};axis:'x'|'y';side:'before'|'after';seam:number}
const rect=(word:OCRWord):OCRRect=>({left:word.x,top:word.y,width:word.width,height:word.height});
const area=(a:OCRRect,b:OCRRect)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));
const union=(items:OCRRect[]):OCRRect=>{let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const item of items){left=Math.min(left,item.left);top=Math.min(top,item.top);right=Math.max(right,item.left+item.width);bottom=Math.max(bottom,item.top+item.height);}return {left,top,width:right-left,height:bottom-top};};
function covered(box:OCRRect,words:OCRRect[]){
 const clipped=words.map(word=>{const left=Math.max(box.left,word.left),top=Math.max(box.top,word.top);return {left,top,width:Math.min(box.left+box.width,word.left+word.width)-left,height:Math.min(box.top+box.height,word.top+word.height)-top};}).filter(word=>word.width>0&&word.height>0).sort((a,b)=>a.top-b.top);
 const edges=[...new Set(clipped.flatMap(word=>[word.left,word.left+word.width]))].sort((a,b)=>a-b);let total=0;
 for(let index=1;index<edges.length;index++){let start=-Infinity,end=-Infinity,height=0;for(const word of clipped){if(word.left>=edges[index]||word.left+word.width<=edges[index-1])continue;if(word.top>end){if(Number.isFinite(end))height+=end-start;start=word.top;end=word.top+word.height;}else end=Math.max(end,word.top+word.height);}if(Number.isFinite(end))height+=end-start;total+=(edges[index]-edges[index-1])*height;}return total;
}

function tokens(part:OCRTileResult,wanted:Set<number>){
 const values=new Map<number,TextToken[]>();for(const token of part.result.document?.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens))||[]){
  const match=/^w(\d+)(?::|$)/.exec(token.wordId);if(!match)continue;const index=Number(match[1]);if(!wanted.has(index))continue;const list=values.get(index)||[];
  list.push({...token,quad:token.quad.map(point=>({x:point.x+part.tile.left,y:point.y+part.tile.top})) as TextToken['quad']});values.set(index,list);
 }return values;
}
/** Finds uncertain facing crop fragments, never infers their text from string similarity. */
export function planOCRSeamRepairs(parts:readonly OCRTileResult[],size:{width:number;height:number},region?:OCRRect,tileEdge=OCR_TILE_EDGE):OCRSeamRepair[]{
 const allowed=region?ocrRect(region,size):{left:0,top:0,...size},buckets=new Map<string,{before:Edge[];after:Edge[]}>();
 let count=0;for(const part of parts){if(part.repair)continue;const tile=part.tile,created:Edge[]=[];
  part.result.words.forEach((source,index)=>{
   if(++count>100000||!source.text.trim())return;
   const clippedLeft=tile.left>allowed.left&&source.x<4,clippedRight=tile.left+tile.width<allowed.left+allowed.width&&tile.width-source.x-source.width<4,clippedTop=tile.top>allowed.top&&source.y<4,clippedBottom=tile.top+tile.height<allowed.top+allowed.height&&tile.height-source.y-source.height<4;
   if(!clippedLeft&&!clippedRight&&!clippedTop&&!clippedBottom)return;
   const word={...source,x:source.x+tile.left,y:source.y+tile.top},base={word,tokens:[] as TextToken[],tiles:new Set([tile.index]),source:{tile:tile.index,word:index},clippedLeft,clippedRight};
   const edges:[Edge['axis'],Edge['side'],number,boolean][]=[['x','after',tile.core.left,base.clippedLeft],['x','before',tile.core.left+tile.core.width,base.clippedRight],['y','after',tile.core.top,clippedTop],['y','before',tile.core.top+tile.core.height,clippedBottom]];
   for(const [axis,side,seam,clipped]of edges)if(clipped){const key=axis+':'+seam,bucket=buckets.get(key)||{before:[],after:[]};const edge={...base,axis,side,seam};bucket[side].push(edge);created.push(edge);buckets.set(key,bucket);}
  });
  if(created.length){const pieces=tokens(part,new Set(created.map(edge=>edge.source.word)));for(const edge of created)edge.tokens=pieces.get(edge.source.word)||[];}
 }
 const repairs:OCRSeamRepair[]=[],seen=new Set<string>();let pixels=0,comparisons=0;
 for(const bucket of buckets.values()){
  const center=(edge:Edge)=>edge.axis==='x'?edge.word.y+edge.word.height/2:edge.word.x+edge.word.width/2;
  bucket.after.sort((a,b)=>center(a)-center(b));
  for(const left of bucket.before){
   let lo=0,hi=bucket.after.length;while(lo<hi){const mid=(lo+hi)>>>1;if(center(bucket.after[mid])<center(left))lo=mid+1;else hi=mid;}
   for(const right of bucket.after.slice(Math.max(0,lo-4),lo+5)){
    if(++comparisons>65536||repairs.length>=OCR_SEAM_REPAIRS)return repairs;
    if(left.source.tile===right.source.tile)continue;
    const a=rect(left.word),b=rect(right.word),overlap=area(a,b);
    if(overlap<Math.min(a.width*a.height,b.width*b.height)*.25)continue;
    const across=left.axis==='x'?Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top):Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left);
    if(across<Math.min(left.axis==='x'?a.height:a.width,left.axis==='x'?b.height:b.width)*.5)continue;
    if(left.word.text.trim()===right.word.text.trim()&&overlap>Math.min(a.width*a.height,b.width*b.height)*.7)continue;
    if(left.axis==='x'&&stitchOCRRow([left,right]).length===1)continue;
    const sources=[left.source,right.source],key=sources.map(source=>source.tile+':'+source.word).sort().join('/');if(seen.has(key))continue;seen.add(key);
    const box=union([a,b]),padding=Math.max(16,Math.min(box.width,box.height)),x=Math.max(allowed.left,Math.floor(box.left-padding)),y=Math.max(allowed.top,Math.floor(box.top-padding));
    const crop={left:x,top:y,width:Math.min(allowed.left+allowed.width,Math.ceil(box.left+box.width+padding))-x,height:Math.min(allowed.top+allowed.height,Math.ceil(box.top+box.height+padding))-y};
    if(crop.width>tileEdge||crop.height>tileEdge||pixels+crop.width*crop.height>OCR_SEAM_PIXELS)continue;
    const target={left:Math.max(allowed.left,Math.floor(box.left)-2),top:Math.max(allowed.top,Math.floor(box.top)-2),width:0,height:0};target.width=Math.min(allowed.left+allowed.width,Math.ceil(box.left+box.width)+2)-target.left;target.height=Math.min(allowed.top+allowed.height,Math.ceil(box.top+box.height)+2)-target.top;
    pixels+=crop.width*crop.height;repairs.push({tile:{...crop,index:parts.length+repairs.length,core:{...target}},target,sources});
   }
  }
 }
 return repairs;
}
/** A fresh, unclipped result must cover every old fragment before any source word is suppressed. */
export function acceptedOCRSeamRepairs(parts:readonly OCRTileResult[],size:{width:number;height:number}){
 const excluded=new Set<string>(),included=new Map<number,Set<number>>(),originals=new Map(parts.filter(part=>!part.repair).map(part=>[part.tile.index,part]));
 for(const part of parts){const repair=part.repair;if(!repair)continue;const selected=new Set<number>(),boxes:OCRRect[]=[];
  part.result.words.forEach((word,index)=>{if(!word.text.trim())return;const global={left:word.x+part.tile.left,top:word.y+part.tile.top,width:word.width,height:word.height},cx=global.left+global.width/2,cy=global.top+global.height/2,target=repair.target;
   if(cx<target.left||cx>target.left+target.width||cy<target.top||cy>target.top+target.height||area(global,target)<global.width*global.height*.3)return;
   if(part.tile.left>0&&word.x<2||part.tile.top>0&&word.y<2||part.tile.left+part.tile.width<size.width&&part.tile.width-word.x-word.width<2||part.tile.top+part.tile.height<size.height&&part.tile.height-word.y-word.height<2)return;
   selected.add(index);boxes.push(global);
  });
  if(!boxes.length||boxes.length>128)continue;
  if(repair.sources.some(source=>{const original=originals.get(source.tile),word=original?.result.words[source.word];if(!original||!word)return true;const box={left:word.x+original.tile.left,top:word.y+original.tile.top,width:word.width,height:word.height};return covered(box,boxes)<box.width*box.height*.7;}))continue;
  if(repair.sources.some(source=>excluded.has(source.tile+':'+source.word)))continue;
  for(const source of repair.sources)excluded.add(source.tile+':'+source.word);included.set(part.tile.index,selected);
 }
 return {excluded,included};
}
