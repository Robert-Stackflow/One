import {OCR_TEXT,ocrDimensions,type OCRLanguage,type OCRResult} from '../../shared/recognition/ocr';
import {textDocument,type TextDocument,type TextQuad} from '../../shared/recognition/text-document';

/** DeepSeek's native OCR refs are regions, not character/word measurements. */
export function deepseekGroundedResult(raw:string,size:{width:number;height:number},language:OCRLanguage,sha256:string,engine:TextDocument['engine']):OCRResult{
  ocrDimensions(size.width,size.height);
  if(typeof raw!=='string'||Buffer.byteLength(raw)>OCR_TEXT)throw Error('DeepSeek 识别结果过长');
  const value=raw.replace(/(?:<｜end▁of▁sentence｜>|<\|endoftext\|>|<\|im_end\|>)\s*$/u,'').trim();
  const regions:{text:string;quads:TextQuad[]}[]=[],texts:string[]=[];
  let valid=true;
  if(value.includes('<|ref|>')){
    const ref='<|ref|>',refEnd='<|/ref|>',det='<|det|>',detEnd='<|/det|>';
    let cursor=0;
    const whitespace=()=>{while(cursor<value.length&&/\s/u.test(value[cursor]))cursor++;};
    while(cursor<value.length){
      whitespace();
      if(cursor===value.length)break;
      if(!value.startsWith(ref,cursor)||texts.length>=4096)throw Error('DeepSeek 定位结果格式无效');
      const start=cursor+ref.length,end=value.indexOf(refEnd,start);
      if(end<0)throw Error('DeepSeek 定位结果不完整');
      const text=value.slice(start,end);cursor=end+refEnd.length;whitespace();
      if(!value.startsWith(det,cursor))throw Error('DeepSeek 定位结果不完整');
      const coordinates=cursor+det.length,close=value.indexOf(detEnd,coordinates);
      if(close<0)throw Error('DeepSeek 定位结果不完整');
      const json=value.slice(coordinates,close);cursor=close+detEnd.length;
      if(json.includes('<|'))throw Error('DeepSeek 定位结果不完整');
      if(!text.trim()||text.includes('<|')||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw Error('DeepSeek 定位文字格式无效');
      texts.push(text);
      let boxes:unknown;if(json.length>8192){valid=false;continue;}
      try{boxes=JSON.parse(json);}catch{valid=false;continue;}
      if(!Array.isArray(boxes)||!boxes.length||boxes.length>64||!boxes.every(box=>Array.isArray(box)&&box.length===4&&
          box.every(number=>Number.isSafeInteger(number)&&number>=0&&number<=999)&&box[0]<box[2]&&box[1]<box[3])){valid=false;continue;}
      const quads:TextQuad[]=boxes.map(([x1,y1,x2,y2])=>{
        const x=x1/999*size.width,y=y1/999*size.height,right=x2/999*size.width,bottom=y2/999*size.height;
        return [{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}];
      });
      regions.push({text,quads});
    }
    if(!texts.length||value.slice(cursor).trim())throw Error('DeepSeek 定位结果不完整');
  }else{
    if(/<\|(?:det|\/ref|\/det)\|>/.test(value))throw Error('DeepSeek 定位结果不完整');
    texts.push(value);valid=false;
  }
  // Never leave an unlocated passage out of select-all: one invalid region removes
  // geometry for the complete result while retaining every recognized passage.
  const words:OCRResult['words']=valid?regions.map(({text,quads},index)=>{
    const x=Math.min(...quads.flatMap(quad=>quad.map(point=>point.x))),y=Math.min(...quads.flatMap(quad=>quad.map(point=>point.y)));
    const right=Math.max(...quads.flatMap(quad=>quad.map(point=>point.x))),bottom=Math.max(...quads.flatMap(quad=>quad.map(point=>point.y)));
    return {text,x,y,width:right-x,height:bottom-y,confidence:0,line:index,block:index};
  }):[];
  const result:OCRResult={...size,language,text:texts.join('\n'),words,confidence:0};
  result.document=textDocument(result,sha256,engine);
  for(const [index,token] of result.document.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens)).entries()){
    token.geometry='region';token.confidence=undefined;
    if(regions[index].quads.length>1)token.sourceQuads=regions[index].quads;
  }
  return result;
}
