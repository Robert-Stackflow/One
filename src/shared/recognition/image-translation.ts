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
    const horizontal=matched.every((token,index)=>Math.abs(token.quad[1].y-token.quad[0].y)<=Math.max(1,textBounds(token.quad).height*.08)&&(index===0||matched[index-1].lineId!==token.lineId||Math.abs(textBounds(token.quad).y-textBounds(matched[index-1].quad).y)<Math.max(textBounds(token.quad).height,textBounds(matched[index-1].quad).height)*.6));
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
      fontSize:Math.max(9,Math.round(bounds.reduce((sum,box)=>sum+box.height,0)/bounds.length*.85)),
      status:!exact||!horizontal||text.length>60000?'unsupported':complete?'ready':'untranslated',
      ...(text.length>60000?{reason:'译文段落过长，保留原图'}:!exact||!horizontal?{reason:'文字方向或原文定位暂不支持'}:!complete?{reason:'段落翻译未完成，保留原图'}:{})});
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
export function imageTextLayout(block:ImageTranslationBlock,measure:(text:string,size:number)=>number):ImageTextLayout {
  const width=Math.max(1,block.rect.width-4),height=Math.max(1,block.rect.height-4),floor=Math.max(9,Math.ceil(block.fontSize*.6));
  const characters=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(block.text)].map(item=>item.segment);
  let answer:ImageTextLayout={fontSize:floor,lineHeight:floor*1.2,lines:[],overflow:true};
  for(let size=Math.max(floor,Math.min(160,block.fontSize));size>=floor;size--){
    const lines:string[]=[];let current='',tooWide=false;
    for(const character of characters){
      if(character==='\n'||character==='\r\n'||character==='\r'){lines.push(current);current='';continue;}
      if(current&&measure(current+character,size)>width){
        const space=current.lastIndexOf(' ');
        if(space>0){lines.push(current.slice(0,space));current=current.slice(space+1)+character;}
        else{lines.push(current);current=character;}
      }else current+=character;
      if(measure(character,size)>width)tooWide=true;
    }
    lines.push(current);answer={fontSize:size,lineHeight:size*1.2,lines,overflow:tooWide||lines.length*size*1.2>height};
    if(!answer.overflow)break;
  }
  return answer;
}
