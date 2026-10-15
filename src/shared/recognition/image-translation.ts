import {imageDimensions} from '../capture/image-limits';
import {readingTokens,textBounds,type TextDocument,type TextQuad} from './text-document';
import type {TranslationResult,TranslationLanguage} from './translation';

export interface TranslationRect {x:number;y:number;width:number;height:number}
export interface ImageTranslationBlock {
  id:string;source:string;text:string;rect:TranslationRect;glyphs:TextQuad[];fontSize:number;
  status:'ready'|'untranslated'|'unsupported';reason?:string;
}
export interface ImageTranslationDocument {
  schema:1;id:string;sourceId:string;recognitionRevision:number;translationId:string;
  width:number;height:number;target:TranslationLanguage;serviceRevision:string;version:number;blocks:ImageTranslationBlock[];
}
export interface ImageTranslationLayer {visible:boolean;document:ImageTranslationDocument}
/** Quad edges retain OCR reading direction, independently of the image's axis-aligned bounds. */
export function imageTranslationRotation(glyphs:TextQuad[]):0|90|180|270|undefined {
  let rotation:0|90|180|270|undefined;
  for(const quad of glyphs){
    const dx=quad[1].x-quad[0].x,dy=quad[1].y-quad[0].y;
    const downX=quad[3].x-quad[0].x,downY=quad[3].y-quad[0].y;
    if(Math.hypot(dx,dy)<.01||Math.hypot(downX,downY)<.01||dx*downY-dy*downX<=0)return;
    const next=Math.abs(dy)<=Math.abs(dx)*.08?(dx>0?0:180):Math.abs(dx)<=Math.abs(dy)*.08?(dy>0?90:270):undefined;
    if(next===undefined||rotation!==undefined&&rotation!==next)return;
    // Reject sheared or independently rotated height edges as well as mixed baselines.
    if(next%180===0?Math.abs(downX)>Math.abs(downY)*.08:Math.abs(downY)>Math.abs(downX)*.08)return;
    rotation=next;
  }
  return rotation;
}
export function imageTranslationFrame(block:ImageTranslationBlock){
  const rotation=imageTranslationRotation(block.glyphs)??0;
  return {rotation,width:rotation%180?block.rect.height:block.rect.width,height:rotation%180?block.rect.width:block.rect.height};
}
export function validateImageTranslation(value:unknown,size:{width:number;height:number}):ImageTranslationDocument {
  const doc=value as ImageTranslationDocument;
  const keys=(object:object,allowed:string[])=>Object.keys(object).every(key=>allowed.includes(key));
  const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max&&!value.includes('\0');
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||!keys(doc,['schema','id','sourceId','recognitionRevision','translationId','width','height','target','serviceRevision','version','blocks'])||doc.schema!==1||doc.width!==size.width||doc.height!==size.height||!text(doc.id,128)||!doc.id||!text(doc.sourceId,2048)||!doc.sourceId||!text(doc.translationId,128)||!doc.translationId||!text(doc.serviceRevision,128)||!doc.serviceRevision||!['zh-Hans','zh-Hant','en','ja','ko','fr','de','es','ru','pt','it','ar'].includes(doc.target)||![doc.recognitionRevision,doc.version].every(number=>Number.isSafeInteger(number)&&number>=0&&number<=1_000_000)||!Array.isArray(doc.blocks)||!doc.blocks.length||doc.blocks.length>2048)throw Error('翻译文字层无效');
  imageDimensions(size.width,size.height);let characters=0,glyphs=0;const ids=new Set<string>();
  for(const block of doc.blocks){
    const rect=block?.rect;
    if(!block||!keys(block,['id','source','text','rect','glyphs','fontSize','status','reason'])||!text(block.id,128)||!block.id||ids.has(block.id)||!text(block.source,200000)||!text(block.text,600000)||(characters+=block.source.length+block.text.length)>800000||!['ready','untranslated','unsupported'].includes(block.status)||block.status==='ready'&&(!block.text.trim()||block.text.length>60000)||block.reason!==undefined&&!text(block.reason,300)||!rect||!keys(rect,['x','y','width','height'])||![rect.x,rect.y,rect.width,rect.height].every(Number.isSafeInteger)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>size.width||rect.y+rect.height>size.height||!Number.isFinite(block.fontSize)||block.fontSize<9||block.fontSize>16384||!Array.isArray(block.glyphs)||!block.glyphs.length||(glyphs+=block.glyphs.length)>400000)throw Error('翻译文字块无效');
    for(const quad of block.glyphs)if(!Array.isArray(quad)||quad.length!==4||quad.some(point=>!point||!keys(point,['x','y'])||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>size.width||point.y>size.height)||Math.abs(quad.reduce((sum,point,index)=>sum+point.x*quad[(index+1)%4].y-point.y*quad[(index+1)%4].x,0))<.02)throw Error('翻译文字位置无效');
    ids.add(block.id);
  }
  for(const block of doc.blocks)if(block.status==='ready'&&doc.blocks.some(other=>other.id!==block.id&&block.rect.x<other.rect.x+other.rect.width&&block.rect.x+block.rect.width>other.rect.x&&block.rect.y<other.rect.y+other.rect.height&&block.rect.y+block.rect.height>other.rect.y))throw Error('翻译文字区域重叠');
  if(new TextEncoder().encode(JSON.stringify(doc)).byteLength>8*1024*1024)throw Error('翻译文字层过大');
  return structuredClone(doc);
}
/** Only editable text/size/status/version can change while transferring a prepared OCR snapshot. */
export function imageTranslationSnapshot(base:ImageTranslationDocument,value:unknown):ImageTranslationDocument {
  const next=validateImageTranslation(value,base);
  if(['id','sourceId','recognitionRevision','translationId','target','serviceRevision'].some(key=>next[key as keyof ImageTranslationDocument]!==base[key as keyof ImageTranslationDocument])||next.blocks.length!==base.blocks.length)throw Error('翻译文字层来源已改变');
  for(let index=0;index<next.blocks.length;index++){
    const block=next.blocks[index],original=base.blocks[index];
    if(block.id!==original.id||block.source!==original.source||block.fontSize!==original.fontSize||block.rect.x!==original.rect.x||block.rect.y!==original.rect.y||JSON.stringify(block.glyphs)!==JSON.stringify(original.glyphs)||original.status==='unsupported'&&block.status!=='unsupported')throw Error('翻译文字层来源已改变');
  }
  return next;
}
/** Source offsets, never guessed text matches, bind each translated paragraph to its image geometry. */
export function imageTranslationDocument(document:TextDocument,result:TranslationResult,id:string):ImageTranslationDocument {
  imageDimensions(document.source.width,document.source.height);
  if(document.text!==result.source||!result.id||!result.parts?.length)throw Error('原文与图片文字位置不一致，请重新识别并翻译');
  const tokens=readingTokens(document),groups=new Map<number,NonNullable<TranslationResult['parts']>>();
  let end=0;
  for(const part of result.parts){
    if(!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||part.start<end||part.end<=part.start||part.end>result.source.length)throw Error('翻译原文范围无效');
    end=part.end;const group=groups.get(part.paragraph)||[];group.push(part);groups.set(part.paragraph,group);
  }
  const blocks:ImageTranslationBlock[]=[];
  for(const [paragraph,parts] of groups){
    const start=parts[0].start,last=parts.at(-1)!.end;
    const matched=tokens.filter(token=>token.sourceStart!==undefined&&token.sourceEnd!==undefined&&token.sourceEnd>start&&token.sourceStart<last);
    if(!matched.length)throw Error('有段落缺少图片坐标，请重新识别');
    let covered=start;
    const exact=matched.every(token=>{const aligned=token.sourceStart!>=covered&&token.sourceEnd!<=last&&/^\s*$/.test(result.source.slice(covered,token.sourceStart))&&result.source.slice(token.sourceStart,token.sourceEnd)===token.text;covered=token.sourceEnd!;return aligned;})&&/^\s*$/.test(result.source.slice(covered,last));
    const rotation=imageTranslationRotation(matched.map(token=>token.quad));
    const thickness=(quad:TextQuad)=>Math.hypot(quad[3].x-quad[0].x,quad[3].y-quad[0].y);
    const aligned=rotation!==undefined&&matched.every((token,index)=>{
      const previous=matched[index-1];if(!previous||previous.lineId!==token.lineId)return true;
      const axis=rotation%180?'x':'y';return Math.abs(token.quad[0][axis]-previous.quad[0][axis])<Math.max(thickness(token.quad),thickness(previous.quad))*.6;
    });
    const bounds=matched.map(token=>textBounds(token.quad));
    const extent=bounds.reduce((value,box)=>({left:Math.min(value.left,box.x),top:Math.min(value.top,box.y),right:Math.max(value.right,box.x+box.width),bottom:Math.max(value.bottom,box.y+box.height)}),{left:Infinity,top:Infinity,right:0,bottom:0});
    const x=Math.max(0,Math.floor(extent.left-1)),y=Math.max(0,Math.floor(extent.top-1));
    const right=Math.min(document.source.width,Math.ceil(extent.right+1));
    const bottom=Math.min(document.source.height,Math.ceil(extent.bottom+1));
    if(right<=x||bottom<=y)throw Error('文字区域超出图片');
    let text='',previous=start;
    for(const part of parts){text+=result.source.slice(previous,part.start)+(part.status==='translated'?part.text||'':result.source.slice(part.start,part.end));previous=part.end;}
    const complete=parts.every(part=>part.status==='translated'&&!!part.text?.trim());
    blocks.push({id:'paragraph-'+paragraph,source:result.source.slice(start,last),text,
      rect:{x,y,width:right-x,height:bottom-y},glyphs:matched.map(token=>token.quad),
      fontSize:Math.max(9,Math.round(matched.reduce((sum,token)=>sum+thickness(token.quad),0)/matched.length*.85)),
      status:!exact||!aligned||text.length>60000?'unsupported':complete?'ready':'untranslated',
      ...(text.length>60000?{reason:'译文段落过长，保留原图'}:!exact||!aligned?{reason:'文字方向或原文定位暂不支持'}:!complete?{reason:'段落翻译未完成，保留原图'}:{})});
  }
  for(const block of blocks)if(blocks.some(other=>other.id!==block.id&&block.rect.x<other.rect.x+other.rect.width&&block.rect.x+block.rect.width>other.rect.x&&block.rect.y<other.rect.y+other.rect.height&&block.rect.y+block.rect.height>other.rect.y)){block.status='unsupported';block.reason='文字区域重叠，保留原图';}
  return {schema:1,id,sourceId:document.id,recognitionRevision:document.revision||0,translationId:result.id,width:document.source.width,height:document.source.height,target:result.target,serviceRevision:result.revision,version:0,blocks};
}
export function editImageTranslation(document:ImageTranslationDocument,id:string,text:string,width:number,height:number):ImageTranslationDocument {
  const block=document.blocks.find(item=>item.id===id);if(!block||block.status==='unsupported')throw Error('译文块不可编辑');
  if(typeof text!=='string'||!text.trim()||text.length>60000||text.includes('\0'))throw Error('请输入有效译文');
  if(![width,height].every(Number.isSafeInteger)||width<1||height<1||block.rect.x+width>document.width||block.rect.y+height>document.height)throw Error('文字区域超出图片');
  const rect={...block.rect,width,height};
  if((width!==block.rect.width||height!==block.rect.height)&&document.blocks.some(other=>other.id!==id&&rect.x<other.rect.x+other.rect.width&&rect.x+rect.width>other.rect.x&&rect.y<other.rect.y+other.rect.height&&rect.y+rect.height>other.rect.y))throw Error('扩展区域与其他文字重叠');
  return {...document,version:document.version+1,blocks:document.blocks.map(item=>item.id===id?{...item,text,rect,status:'ready',reason:undefined}:item)};
}
export interface ImageTextLayout {fontSize:number;lineHeight:number;lines:string[];overflow:boolean}
/** Keep a readable font floor; overflow is explicit and never silently shrunk indefinitely. */
function* imageTextLayoutSteps(block:ImageTranslationBlock,measure:(text:string,size:number)=>number):Generator<void,ImageTextLayout> {
  const frame=imageTranslationFrame(block),width=Math.max(1,frame.width-4),height=Math.max(1,frame.height-4),floor=Math.max(9,Math.ceil(block.fontSize*.6));
  const characters:string[]=[];let work=0;
  for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(block.text)){characters.push(segment);if(++work%256===0)yield;}
  let answer:ImageTextLayout={fontSize:floor,lineHeight:floor*1.2,lines:[],overflow:true};
  for(let size=Math.max(floor,Math.min(160,block.fontSize));size>=floor;size--){
    const lines:string[]=[],widths=new Map<string,number>();let current='',tooWide=false;
    const emit=(line:string)=>{lines.push(line);if(measure(line,size)>width)tooWide=true;};
    for(const character of characters){
      if(++work%256===0)yield;
      if(character==='\n'||character==='\r\n'||character==='\r'){emit(current);current='';continue;}
      if(current&&measure(current+character,size)>width){
        const space=current.lastIndexOf(' ');
        if(space>0){emit(current.slice(0,space));current=current.slice(space+1);if(current&&measure(current+character,size)>width){emit(current);current='';}}
        else{emit(current);current='';}
      }
      current+=character;
      let characterWidth=widths.get(character);if(characterWidth===undefined){characterWidth=measure(character,size);if(widths.size<2048)widths.set(character,characterWidth);}
      if(characterWidth>width)tooWide=true;
    }
    emit(current);answer={fontSize:size,lineHeight:size*1.2,lines,overflow:tooWide||lines.length*size*1.2>height};
    if(!answer.overflow)break;
    yield;
  }
  return answer;
}
export function imageTextLayout(block:ImageTranslationBlock,measure:(text:string,size:number)=>number):ImageTextLayout {
  const steps=imageTextLayoutSteps(block,measure);for(;;){const next=steps.next();if(next.done)return next.value;}
}
/** Same layout and complete text, with cancellation points during segmentation and measurement. */
export async function imageTextLayoutAsync(block:ImageTranslationBlock,measure:(text:string,size:number)=>number,control:{valid():boolean;yieldControl():Promise<void>}):Promise<ImageTextLayout> {
  const check=()=>{if(!control.valid())throw Error('图片翻译已取消');},steps=imageTextLayoutSteps(block,measure);
  for(;;){check();const next=steps.next();check();if(next.done)return next.value;await control.yieldControl();}
}
