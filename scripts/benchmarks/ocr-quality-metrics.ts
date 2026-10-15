import type {OCRResult} from '../../src/shared/recognition/ocr';
import {readingTokens,selectedText,textBounds} from '../../src/shared/recognition/text-document';
export interface QualityKeyRegion {id:string;text:string;rect:{left:number;top:number;width:number;height:number}}
export function ocrCanonical(value:string,whitespace:'collapse'|'remove'='remove'){
  const normalized=value.normalize('NFKC');return whitespace==='remove'?normalized.replace(/\s/gu,''):normalized.replace(/\s+/gu,' ').trim();
}
/** Myers bit-vector edit distance over Unicode code points, with bounded bit width. */
export function ocrEditDistance(expected:string,actual:string){
  let a=Array.from(expected),b=Array.from(actual);if(a.length>b.length)[a,b]=[b,a];
  if(!a.length)return b.length;
  const bits=new Map<string,bigint>();for(let index=0;index<a.length;index++)bits.set(a[index],(bits.get(a[index])||0n)|(1n<<BigInt(index)));
  const mask=(1n<<BigInt(a.length))-1n,last=1n<<BigInt(a.length-1);let positive=mask,negative=0n,distance=a.length;
  for(const letter of b){
    const equal=bits.get(letter)||0n,vertical=equal|negative,horizontal=(((equal&positive)+positive)^positive)|equal;
    let up=negative|~(horizontal|positive),down=positive&horizontal;
    if(up&last)distance++;else if(down&last)distance--;
    up=(up<<1n)|1n;down<<=1n;positive=(down|~(vertical|up))&mask;negative=(up&vertical)&mask;
  }
  return distance;
}
function bagDistance(a:string,b:string){
  const counts=new Map<string,number>();for(const c of a)counts.set(c,(counts.get(c)||0)+1);for(const c of b)counts.set(c,(counts.get(c)||0)-1);
  let missing=0,extra=0;for(const count of counts.values()){if(count>0)missing+=count;else extra-=count;}return Math.max(missing,extra);
}
export function ocrQualityScore(expected:string,actual:string){
  const reference=ocrCanonical(expected),hypothesis=ocrCanonical(actual),strictReference=ocrCanonical(expected,'collapse'),strictHypothesis=ocrCanonical(actual,'collapse');
  if(!reference.length)throw Error('OCR quality reference must contain text');
  const characters=Array.from(reference).length,errors=ocrEditDistance(reference,hypothesis),strictCharacters=Array.from(strictReference).length;
  return {characters,errors,cer:errors/characters,strictCharacters,strictErrors:ocrEditDistance(strictReference,strictHypothesis),orderFreeErrors:bagDistance(reference,hypothesis),exact:reference===hypothesis};
}
/** A selection proxy on manually marked key regions; never a detector/glyph accuracy claim. */
export function ocrKeyRegionScores(result:OCRResult|undefined,regions:readonly QualityKeyRegion[]){
  const tokens=result?.document?readingTokens(result.document):[];
  return regions.map(region=>{
    const {left,top,width,height}=region.rect,indices=tokens.flatMap((token,index)=>(token.sourceQuads||[token.quad]).some(shape=>{const box=textBounds(shape),x=box.x+box.width/2,y=box.y+box.height/2;return x>=left&&y>=top&&x<=left+width&&y<=top+height;})?[index]:[]);
    const first=indices[0],last=indices.at(-1),chosen=first===undefined?[]:tokens.slice(first,last!+1),copied=first===undefined?'':selectedText(tokens,first,last!);
    const boxes=chosen.flatMap(token=>(token.sourceQuads||[token.quad]).map(textBounds));let boxIoU=0;
    if(boxes.length){const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.width)),bottom=Math.max(...boxes.map(b=>b.y+b.height));
      const intersection=Math.max(0,Math.min(right,left+width)-Math.max(x,left))*Math.max(0,Math.min(bottom,top+height)-Math.max(y,top));boxIoU=intersection/((right-x)*(bottom-y)+width*height-intersection);}
    return {id:region.id,score:ocrQualityScore(region.text,copied),copied,boxIoU,selectedTokens:chosen.length,geometry:[...new Set(chosen.map(token=>token.geometry))]};
  });
}
export interface QualityRecord {tags:string[];status:'ok'|'failed';score:ReturnType<typeof ocrQualityScore>;milliseconds:number;peakRSSMiB?:number;keyRegions?:ReturnType<typeof ocrKeyRegionScores>}
export function aggregateOCRQuality(records:readonly QualityRecord[]){
  const summarize=(values:readonly QualityRecord[])=>{
    const characters=values.reduce((sum,r)=>sum+r.score.characters,0),errors=values.reduce((sum,r)=>sum+r.score.errors,0),times=values.map(r=>r.milliseconds).sort((a,b)=>a-b);
    const keys=values.flatMap(value=>value.keyRegions||[]);
    return {samples:values.length,failed:values.filter(r=>r.status==='failed').length,characters,errors,cer:characters?errors/characters:null,
      macroCER:values.length?values.reduce((sum,r)=>sum+r.score.cer,0)/values.length:null,
      strictCER:values.length?values.reduce((sum,r)=>sum+r.score.strictErrors,0)/values.reduce((sum,r)=>sum+r.score.strictCharacters,0):null,
      orderFreeCER:characters?values.reduce((sum,r)=>sum+r.score.orderFreeErrors,0)/characters:null,
      exact:values.filter(r=>r.status==='ok'&&r.score.exact).length,medianMs:times.length?times[Math.floor(times.length/2)]:null,p95Ms:times.length?times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)]:null,
      peakRSSMiB:values.some(r=>r.peakRSSMiB!==undefined)?Math.max(...values.map(r=>r.peakRSSMiB||0)):null,
      keySelectionProxy:keys.length?{sourceImages:values.filter(value=>value.keyRegions?.length).length,regions:keys.length,copyCER:keys.reduce((sum,k)=>sum+k.score.errors,0)/keys.reduce((sum,k)=>sum+k.score.characters,0),meanBoxIoU:keys.reduce((sum,k)=>sum+k.boxIoU,0)/keys.length}:null};
  };
  return {total:summarize(records),strata:Object.fromEntries([...new Set(records.flatMap(r=>r.tags))].sort().map(tag=>[tag,summarize(records.filter(r=>r.tags.includes(tag)))]))};
}
