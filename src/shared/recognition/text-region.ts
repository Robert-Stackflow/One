import { OCR_TEXT,type OCRResult } from './ocr';
import { readingTokens,selectedText,textBounds,type TextDocument,type TextToken,type TextQuad } from './text-document';
import type { OCRRect } from './ocr-tiles';
export interface OCRRegionSelection { revision:number;anchor:number;focus:number }
interface Group { key:string;line:string;tokens:TextToken[];indices:number[];box:ReturnType<typeof textBounds> }
export { groups as ocrWordGroups, bounds as ocrTokenBounds };
const shape=(box:{x:number;y:number;width:number;height:number}):TextQuad=>[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}];
function bounds(tokens:readonly TextToken[]){
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const token of tokens){const box=textBounds(token.quad);x=Math.min(x,box.x);y=Math.min(y,box.y);right=Math.max(right,box.x+box.width);bottom=Math.max(bottom,box.y+box.height);}
  return {x,y,width:right-x,height:bottom-y};
}
function groups(document:TextDocument):Group[]{
  const result:Group[]=[],byKey=new Map<string,Group>();
  readingTokens(document).forEach((token,index)=>{
    const key=token.lineId+'\0'+token.wordId;let group=byKey.get(key);
    if(!group){group={key,line:token.lineId,tokens:[],indices:[],box:textBounds(token.quad)};byKey.set(key,group);result.push(group);}
    group.tokens.push(token);group.indices.push(index);
  });
  for(const group of result)group.box=bounds(group.tokens);
  return result;
}
export function validateOCRSelection(result:OCRResult,value:unknown){
  const document=result.document,tokens=document?readingTokens(document):[];
  if(!document||!tokens.length)throw Error('当前结果没有可用的字词坐标，请先识别全文');
  const start=tokens[0].sourceStart,end=tokens.at(-1)!.sourceEnd,leading=start===undefined?'':document.text.slice(0,start),trailing=end===undefined?'':document.text.slice(end);
  if(document.text!==result.text||( /^\s*$/.test(leading)?leading:'' )+selectedText(tokens,0,tokens.length-1)+( /^\s*$/.test(trailing)?trailing:'' )!==document.text)
    throw Error('当前原文与字词坐标不一致，请重新识别全文；原文已保留');
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||!['revision','anchor','focus'].every(key=>Object.hasOwn(value,key)))throw Error('局部识别选择无效');
  const selection=value as OCRRegionSelection;
  if(!Object.values(selection).every(Number.isSafeInteger)||selection.revision!==(document.revision||0)||Math.min(selection.anchor,selection.focus)<0||Math.max(selection.anchor,selection.focus)>=tokens.length)throw Error('选中文字已改变，请重新选择');
  return {document,tokens,selection};
}
export function selectedOCRRegion(result:OCRResult,value:unknown){
  const {document,tokens,selection}=validateOCRSelection(result,value);
  if((document.revisions?.length||0)>=64)throw Error('局部识别次数已满，请重新识别全文');
  const first=Math.min(selection.anchor,selection.focus),last=Math.max(selection.anchor,selection.focus);
  const selected=groups(document).filter(group=>group.indices.some(index=>index>=first&&index<=last));
  if(selected.length>1024)throw Error('局部识别最多选择 1,024 个词，请缩小选区或识别全文');
  // Recognize complete words instead of clipping the selected character at its glyph edge.
  const box=bounds(selected.flatMap(group=>group.tokens)),size=document.source;
  const left=Math.max(0,Math.floor(box.x)),top=Math.max(0,Math.floor(box.y));
  const core:OCRRect={left,top,width:Math.min(size.width,Math.ceil(box.x+box.width))-left,height:Math.min(size.height,Math.ceil(box.y+box.height))-top};
  if(core.width<1||core.height<1)throw Error('选中文字的原图位置无效');
  const padding=Math.min(64,Math.max(16,Math.ceil(Math.max(...selected.map(group=>group.box.height))*.4)));
  const x=Math.max(0,left-padding),y=Math.max(0,top-padding);
  return {selection:{...selection},core,context:{left:x,top:y,width:Math.min(size.width,left+core.width+padding)-x,height:Math.min(size.height,top+core.height+padding)-y}};
}
/** Only selected words change. Unselected tokens retain IDs, source quads and reading order. */
export function replaceOCRSelection(base:OCRResult,patch:OCRResult,selection:OCRRegionSelection):OCRResult{
  const area=selectedOCRRegion(base,selection),old=base.document!,incoming=patch.document;
  if(!incoming||incoming.source.sha256!==old.source.sha256||patch.width!==base.width||patch.height!==base.height||incoming.source.width!==base.width||incoming.source.height!==base.height)
    throw Error('局部识别的原图或坐标不一致，原文已保留');
  const before=groups(old),first=Math.min(selection.anchor,selection.focus),last=Math.max(selection.anchor,selection.focus);
  const chosen=before.filter(group=>group.indices.some(index=>index>=first&&index<=last)),keys=new Set(chosen.map(group=>group.key));
  const unselected=before.filter(group=>!keys.has(group.key)&&group.box.x+group.box.width>=area.core.left&&group.box.x<=area.core.left+area.core.width&&group.box.y+group.box.height>=area.core.top&&group.box.y<=area.core.top+area.core.height);
  const after=groups(incoming);
  if(after.length>4096||unselected.length>2048)throw Error('局部识别区域文字过多，请缩小选区；原文已保留');
  const replacements=new Map<string,Group[]>(),revision=(old.revision||0)+1;
  for(const group of after){
    const {box}=group,cx=box.x+box.width/2,cy=box.y+box.height/2,{core}=area;
    if(cx<core.left-2||cy<core.top-2||cx>core.left+core.width+2||cy>core.top+core.height+2)continue;
    // Context is decoded for recognition quality, but adjacent unselected words cannot leak into the patch.
    if(unselected.some(other=>cx>=other.box.x&&cx<=other.box.x+other.box.width&&cy>=other.box.y&&cy<=other.box.y+other.box.height))continue;
    let nearest=chosen[0],distance=Infinity;
    for(const candidate of chosen){const b=candidate.box,dx=Math.max(b.x-cx,0,cx-b.x-b.width),dy=Math.max(b.y-cy,0,cy-b.y-b.height);
      const score=(dx*dx+dy*dy*4)/Math.max(1,b.height*b.height);if(score<distance){distance=score;nearest=candidate;}}
    const tokens=group.tokens.map(token=>({...structuredClone(token),id:`r${revision}:${token.id}`,wordId:`r${revision}:${token.wordId}`,lineId:nearest.line,recognitionRevision:revision}));
    const next={...group,key:`r${revision}:${group.key}`,line:nearest.line,tokens};
    const values=replacements.get(nearest.key)||[];values.push(next);replacements.set(nearest.key,values);
  }
  if(!replacements.size)throw Error('该区域未识别到可用文字，原文已保留');
  for(const group of chosen){const values=replacements.get(group.key);if(values?.length)values.at(-1)!.tokens.at(-1)!.separatorAfter=group.tokens.at(-1)!.separatorAfter;}
  const ordered=before.flatMap(group=>keys.has(group.key)?replacements.get(group.key)||[]:[structuredClone(group)]);
  const originalFirst=readingTokens(old)[0];let text=originalFirst.sourceStart===undefined?'':old.text.slice(0,originalFirst.sourceStart),order=0;
  for(let index=0;index<ordered.length;index++){
    const group=ordered[index],next=ordered[index+1],tail=group.tokens.at(-1)!;
    if(!next){const last=readingTokens(old).at(-1)!;tail.separatorAfter=last.sourceEnd===undefined?'':old.text.slice(last.sourceEnd);}
    else if(group.line!==next.line)tail.separatorAfter=tail.separatorAfter.includes('\n')?tail.separatorAfter:'\n';
    else if(tail.separatorAfter.includes('\n'))tail.separatorAfter=' ';
    for(const token of group.tokens){token.order=order++;token.sourceStart=text.length;text+=token.text;token.sourceEnd=text.length;text+=token.separatorAfter;}
    if(text.length>OCR_TEXT||order>200000)throw Error('局部识别结果过多，原文已保留');
  }
  const doc=structuredClone(old),byLine=new Map<string,TextToken[]>();
  for(const group of ordered){const tokens=byLine.get(group.line)||[];tokens.push(...group.tokens);byLine.set(group.line,tokens);}
  for(const block of doc.blocks){block.lines=block.lines.flatMap(line=>{const tokens=byLine.get(line.id);return tokens?.length?[{...line,tokens,quad:shape(bounds(tokens))}]:[];});
    if(block.lines.length)block.quad=shape(bounds(block.lines.flatMap(line=>line.tokens)));}
  doc.blocks=doc.blocks.filter(block=>block.lines.length);doc.text=text;doc.alignment='source';doc.revision=revision;
  doc.id=old.id.replace(/:r\d+$/,'')+`:r${revision}`;
  doc.revisions=[...(old.revisions||[]),{revision,region:area.core,context:area.context,contextToSource:[1,0,0,1,area.context.left,area.context.top],engine:structuredClone(incoming.engine),language:incoming.language}];
  const locations=new Map<string,{block:number;line:number}>();doc.blocks.forEach((block,index)=>block.lines.forEach((line,row)=>locations.set(line.id,{block:index,line:row})));
  const words=ordered.map(group=>({...group.box,text:selectedText(group.tokens,0,group.tokens.length-1),confidence:0,...locations.get(group.line)!}));
  return {...base,text,words,confidence:0,document:doc,inference:patch.inference};
}
