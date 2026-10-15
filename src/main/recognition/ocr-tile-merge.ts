import {stitchOCRRow,type StitchFragment} from './ocr-tile-stitch';
import {orderOCRFragments,TEXT_LAYOUT_VERSION} from '../../shared/recognition/text-layout';
import { imageDimensions } from '../../shared/capture/image-limits';
import { OCR_TEXT,type OCRResult } from '../../shared/recognition/ocr';
import { textBounds,textDocument,type TextToken,type TextQuad } from '../../shared/recognition/text-document';
import type { OCRTile } from '../../shared/recognition/ocr-tiles';
interface Candidate extends StitchFragment {margin:number;owned:boolean}
export interface OCRTileResult { tile:OCRTile;result:OCRResult }
const quad=(x:number,y:number,width:number,height:number):TextQuad=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
/** Keep context detections until deduplication: coordinate jitter can put both copies outside their cores. */
export function mergeOCRTiles(parts:readonly OCRTileResult[],size:{width:number;height:number},sha256:string):OCRResult{
  imageDimensions(size.width,size.height);
  const engine=parts[0]?.result.document?.engine,language=parts[0]?.result.language;
  if(!engine||!language||!parts.length)throw Error('长图识别缺少模型或坐标信息');
  const candidates:Candidate[]=[],bins=new Map<string,Candidate[]>(),devices=new Set<string>();let tokenCount=0,textSize=0;
  for(const {tile,result} of parts){
    const doc=result.document;
    if(!doc||doc.engine.id!==engine.id||doc.engine.model!==engine.model||doc.engine.version!==engine.version||result.language!==language||
      result.width!==tile.width||result.height!==tile.height)throw Error('长图识别模型或尺寸不一致');
    devices.add(doc.engine.device);
    const tokens=new Map<number,TextToken[]>();
    for(const token of doc.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens))){
      const match=/^w(\d+)(?::|$)/.exec(token.wordId);if(!match)continue;
      const index=Number(match[1]),values=tokens.get(index)||[];values.push(token);tokens.set(index,values);
    }
    result.words.forEach((source,index)=>{
      const x=source.x+tile.left,y=source.y+tile.top,cx=x+source.width/2,cy=y+source.height/2;
      if(!source.text.trim())return;
      const owned=cx>=tile.core.left&&cx<tile.core.left+tile.core.width&&cy>=tile.core.top&&cy<tile.core.top+tile.core.height;
      // Discard clipped context fragments, never text touching the real image border.
      if(!owned&&(tile.left>0&&source.x<2||tile.top>0&&source.y<2||tile.left+tile.width<size.width&&tile.width-source.x-source.width<2||tile.top+tile.height<size.height&&tile.height-source.y-source.height<2))return;
      const word={...source,x,y,symbols:source.symbols?.map(symbol=>({...symbol,x:symbol.x+tile.left,y:symbol.y+tile.top}))};
      const move=(shape:TextQuad)=>shape.map(point=>({x:point.x+tile.left,y:point.y+tile.top})) as TextQuad;
      const pieces=(tokens.get(index)||[]).map(token=>({...token,quad:move(token.quad),sourceQuads:token.sourceQuads?.map(move)}));
      const candidate:Candidate={word,tokens:pieces,owned,tiles:new Set([tile.index]),clippedLeft:tile.left>0&&source.x<4,clippedRight:tile.left+tile.width<size.width&&tile.width-source.x-source.width<4,margin:Math.min(source.x,source.y,tile.width-source.x-source.width,tile.height-source.y-source.height)};
      const bx=Math.floor(cx/64),by=Math.floor(cy/64),text=source.text.trim();let duplicate:Candidate|undefined;
      for(let dy=-1;dy<=1&&!duplicate;dy++)for(let dx=-1;dx<=1&&!duplicate;dx++)for(const other of bins.get(`${text}:${bx+dx}:${by+dy}`)||[]){
        const overlap=Math.max(0,Math.min(x+word.width,other.word.x+other.word.width)-Math.max(x,other.word.x))*
          Math.max(0,Math.min(y+word.height,other.word.y+other.word.height)-Math.max(y,other.word.y));
        if(overlap/Math.max(1,Math.min(word.width*word.height,other.word.width*other.word.height))>.7){duplicate=other;break;}
      }
      if(duplicate){if(candidate.margin>duplicate.margin||candidate.margin===duplicate.margin&&candidate.owned&&!duplicate.owned)Object.assign(duplicate,candidate);return;}
      tokenCount+=Math.max(1,pieces.length);
      textSize+=word.text.length+1;if(textSize>OCR_TEXT)throw Error('长图文字过长，输入已保留');
      if(candidates.length>=50000||tokenCount>200000)throw Error('长图文字过多，输入已保留，请裁剪后重试');
      candidates.push(candidate);const key=`${text}:${bx}:${by}`,bucket=bins.get(key)||[];bucket.push(candidate);bins.set(key,bucket);
    });
  }
  // Join horizontal row fragments across tile columns without merging different rows.
  const rows:{items:Candidate[];top:number;bottom:number}[]=[];
  for(const item of candidates.sort((a,b)=>a.word.y-b.word.y||a.word.x-b.word.x)){
    const {y,height}=item.word;let row:typeof rows[number]|undefined;
    for(let index=rows.length-1;index>=0;index--){
      const candidate=rows[index];if(candidate.bottom<y-Math.max(height,64))break;
      const overlap=Math.min(y+height,candidate.bottom)-Math.max(y,candidate.top);
      if(overlap>.5*Math.min(height,candidate.bottom-candidate.top)){row=candidate;break;}
    }
    if(row){row.items.push(item);row.top=Math.min(row.top,y);row.bottom=Math.max(row.bottom,y+height);}
    else rows.push({items:[item],top:y,bottom:y+height});
  }
  rows.sort((a,b)=>a.top-b.top);
  const rowOrdered=rows.flatMap((row,line)=>stitchOCRRow(row.items.sort((a,b)=>a.word.x-b.word.x)).map(item=>{item.word.line=line;item.word.block=0;return item;}));
  const ordered=orderOCRFragments(rowOrdered).items;
  let text='';const starts:number[]=[];
  for(let index=0;index<ordered.length;index++){
    if(index)text+=ordered[index].word.line===ordered[index-1].word.line?' ':'\n';
    starts.push(text.length);text+=ordered[index].word.text;if(text.length>OCR_TEXT)throw Error('长图文字过长，输入已保留');
  }
  const result:OCRResult={...size,language,text,words:ordered.map(item=>item.word),confidence:ordered.length?ordered.reduce((sum,item)=>sum+item.word.confidence,0)/ordered.length:0};
  const document=textDocument(result,sha256,{...engine,version:engine.version.endsWith('+'+TEXT_LAYOUT_VERSION)?engine.version:engine.version+'+'+TEXT_LAYOUT_VERSION,device:[...devices].join(' / ')});
  let count=0;const segmenter=new Intl.Segmenter(language==='eng'?'en':'zh',{granularity:'word'});
  for(const line of document.blocks.flatMap(block=>block.lines)){
    line.tokens=line.tokens.flatMap(base=>{
      const index=Number(base.wordId.slice(1)),{tokens,word}=ordered[index];
      // Tesseract already has true glyphs. Replace only one base word with preserved Paddle hints.
      if(base.geometry!=='word'||!tokens.length||!tokens.every(token=>token.quad.length===4&&token.quad.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.y>=0&&point.x<=size.width&&point.y<=size.height)))return [base];
      let cursor=0;const offsets=tokens.map(token=>{const start=word.text.indexOf(token.text,cursor);if(start<0)return;cursor=start+token.text.length;return {start,end:cursor};});
      if(offsets.some(value=>!value))return [base];
      const segments=[...segmenter.segment(word.text)];let segmentIndex=0;
      return tokens.map((token,part)=>{
        while(segmentIndex+1<segments.length&&segments[segmentIndex+1].index<=offsets[part]!.start)segmentIndex++;
        const wordId=token.geometry==='ctc'?`w${index}:${segments[segmentIndex]?.index??offsets[part]!.start}`:`w${index}${token.wordId.slice(token.wordId.indexOf(':')<0?token.wordId.length:token.wordId.indexOf(':'))}`;
        return {...token,id:`tiled-w${index}-t${part}`,wordId,lineId:line.id,sourceStart:starts[index]+offsets[part]!.start,sourceEnd:starts[index]+offsets[part]!.end,
          separatorAfter:word.text.slice(offsets[part]!.end,offsets[part+1]?.start??word.text.length)+(part===tokens.length-1?base.separatorAfter:'')};
      });
    });
    for(const token of line.tokens)token.order=count++;
    const bounds=line.tokens.map(token=>textBounds(token.quad));
    if(bounds.length){const x=Math.min(...bounds.map(box=>box.x)),y=Math.min(...bounds.map(box=>box.y));line.quad=quad(x,y,Math.max(...bounds.map(box=>box.x+box.width))-x,Math.max(...bounds.map(box=>box.y+box.height))-y);}
  }
  if(count>200000)throw Error('长图字形过多，输入已保留');
  document.alignment='reconstructed';result.document=document;
  const inference=parts.map(part=>part.result.inference).filter(value=>!!value);
  if(inference.length)result.inference={...inference[inference.length-1],device:[...new Set(inference.map(value=>value.device))].join(' / '),fallbackReason:inference.find(value=>value.fallbackReason)?.fallbackReason};
  return result;
}
