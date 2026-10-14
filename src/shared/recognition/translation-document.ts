import {TRANSLATION_DOCUMENT_PARTS,TRANSLATION_DOCUMENT_OUTPUT,type TranslationPart,type TranslationResult} from './translation';

/** Newlines/blank lines stay outside text ranges; offsets always refer to the frozen source. */
export function translationParts(source:string,budget:number):TranslationPart[]{
  if(!Number.isSafeInteger(budget)||budget<32||budget>20000)throw Error('翻译分批长度无效');
  const parts:TranslationPart[]=[];let paragraph=0;
  for(const match of source.matchAll(/[^\r\n]+/g)){
    if(!match[0].trim())continue;paragraph++;let start=match.index!,end=start+match[0].length,chunk=0;
    while(start<end){
      let boundary=Math.min(end,start+budget);
      if(boundary<end){
        if(/[\uD800-\uDBFF]/.test(source[boundary-1]))boundary--;
        const candidates=source.slice(start,boundary).matchAll(/[。！？.!?;；，,\s]/g);let preferred=0;
        for(const point of candidates)if(point.index!>=budget/2)preferred=start+point.index!+point[0].length;
        if(preferred)boundary=preferred;
      }
      if(parts.length>=TRANSLATION_DOCUMENT_PARTS)throw Error('原文段落过多，请缩短原文或提高模型输出上限');
      const piece=source.slice(start,boundary),trimmed=piece.trim();
      if(trimmed){const textStart=start+piece.indexOf(trimmed);parts.push({id:parts.length?'p'+(parts.length+1):'source',start:textStart,end:textStart+trimmed.length,paragraph,chunk:++chunk,status:'waiting'});}start=boundary;
    }
  }
  return parts;
}
export function translationBatches(parts:TranslationPart[],budget:number,maxParts=32){
  const batches:TranslationPart[][]=[];let batch:TranslationPart[]=[],length=0;
  for(const part of parts){const size=part.end-part.start;if(size>budget)throw Error('翻译段落超过单批上限');
    if(batch.length&&(length+size>budget||batch.length>=maxParts)){batches.push(batch);batch=[];length=0;}
    batch.push(part);length+=size;
  }
  if(batch.length)batches.push(batch);if(batches.length>512)throw Error('此模型需要过多翻译批次，请提高模型输出上限或缩短原文');return batches;
}
export function assembleTranslation(result:TranslationResult):TranslationResult{
  if(!result.parts)return result;let text='',position=0;
  for(const part of result.parts){text+=result.source.slice(position,part.start)+(part.status==='translated'?part.text||'':'');position=part.end;}
  text+=result.source.slice(position);if(text.length>TRANSLATION_DOCUMENT_OUTPUT)throw Error('译文超过可处理范围');
  const models=[...new Set(result.parts.filter(part=>part.status==='translated'&&part.model).map(part=>part.model!))];
  return {...result,text,model:models.length?models.slice(0,3).join(', ')+(models.length>3?', …':''):result.model,parts:result.parts.map(part=>({...part}))};
}
