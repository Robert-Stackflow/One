import type { TextPoint, TextQuad, TextDocument } from '../../shared/recognition/text-document';
import type { PaddleRecResult } from './paddle-recognizer';

export type TextProjection = readonly [number,number,number,number,number,number,number,number,number];
/** Unit crop -> original quadrilateral, shared by image sampling and CTC hint projection. */
export function paddleTextProjection(quad:TextQuad):TextProjection {
  if(quad.length!==4||!quad.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)))throw Error('OCR 文字区域坐标无效');
  const [p0,p1,p2,p3]=quad;
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
  let g=0,h=0;
  if(Math.abs(dx3)+Math.abs(dy3)>1e-9){
    const determinant=dx1*dy2-dx2*dy1;if(Math.abs(determinant)<1e-9)throw Error('OCR 文字区域透视变换无效');
    g=(dx3*dy2-dx2*dy3)/determinant;h=(dx1*dy3-dx3*dy1)/determinant;
  }
  return [p1.x-p0.x+g*p1.x,p3.x-p0.x+h*p3.x,p0.x,p1.y-p0.y+g*p1.y,p3.y-p0.y+h*p3.y,p0.y,g,h,1];
}
export function projectPaddlePoint(matrix:TextProjection,u:number,v:number):TextPoint {
  const denominator=matrix[6]*u+matrix[7]*v+1;
  if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-9)throw Error('OCR 文字区域透视变换无效');
  return {x:(matrix[0]*u+matrix[1]*v+matrix[2])/denominator,y:(matrix[3]*u+matrix[4]*v+matrix[5])/denominator};
}
export interface CTCTextRegion { text:string;start:number;end:number;quad:TextQuad;confidence:number }
interface AlignmentPixels {data:Uint8Array;width:number;height:number}
/** High-contrast ink columns can tighten a CTC hint; ambiguous segmentation leaves the hint unchanged. */
function inkEdges(pixels:AlignmentPixels,glyphs:readonly {glyph:PaddleRecResult['glyphs'][number]}[],scale:number):number[]|undefined {
  const {data,width,height}=pixels,n=glyphs.length;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2||data.length!==width*height*3||width*height>4_000_000||!n)return;
  const gray=new Uint8Array(width*height),hist=new Uint32Array(256),border=new Uint32Array(256);let borders=0,sum=0,squares=0;
  try{
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,v=Math.round(data[i*3]*.299+data[i*3+1]*.587+data[i*3+2]*.114);gray[i]=v;hist[v]++;sum+=v;squares+=v*v;
    if(x<2||x>=width-2||y<2||y>=height-2){border[v]++;borders++;}
  }
  let count=0,partial=0,best=0,threshold=0,contrast=0;
  for(let t=0;t<256;t++){
    count+=hist[t];partial+=hist[t]*t;if(!count||count===gray.length)continue;
    const mean=partial/count-(sum-partial)/(gray.length-count),score=count*(gray.length-count)*mean*mean;
    if(score>best){best=score;threshold=t;contrast=Math.abs(mean);}
  }
  const variance=squares-gray.length*(sum/gray.length)**2;
  if(!variance||contrast<64||best/(gray.length*variance)<.8)return;
  const darkBorder=border.slice(0,threshold+1).reduce((a,b)=>a+b,0)/borders;
  if(darkBorder>.3&&darkBorder<.7)return;const darkInk=darkBorder<=.3;
  const groups:{start:number;end:number}[]=[];let open=-1;
  for(let x=0;x<=width;x++){
    let ink=0;if(x<width)for(let y=0;y<height;y++)if(darkInk?gray[y*width+x]<=threshold:gray[y*width+x]>threshold)ink++;
    const present=ink>=Math.max(1,Math.floor(height*.02));
    if(present&&open<0)open=x;
    if(!present&&open>=0){groups.push({start:open,end:x});open=-1;}
  }
  const m=groups.length;if(m<n||m>n*4||n*m>200000)return;
  const cols=m+1,cost=new Float64Array((n+1)*cols).fill(Infinity),trace=new Uint8Array(cost.length);cost[0]=0;
  for(let i=0;i<n;i++)for(let j=0;j<m;j++){
    const before=cost[i*cols+j];if(!Number.isFinite(before))continue;
    const glyph=glyphs[i].glyph,han=/^\p{Script=Han}$/u.test(glyph.text),maximum=han?4:1;
    for(let k=1;k<=maximum&&j+k<=m;k++){
      const first=groups[j],last=groups[j+k-1],span=last.end-first.start;
      if(span>height*(han?.95:1.3)||han&&span<height*.3)continue;
      if(k>1&&groups.slice(j+1,j+k).some((value,index)=>value.start-groups[j+index].end>height*.12))continue;
      const center=(first.start+last.end)/2/width,expected=(glyph.start+glyph.end)*.5*scale;
      if(Math.abs(center-expected)>Math.max(.12,1/n))continue;
      const next=before+(center-expected)**2*100+(han?(span/height-.6)**2:0),at=(i+1)*cols+j+k;
      if(next<cost[at]){cost[at]=next;trace[at]=k;}
    }
  }
  if(!Number.isFinite(cost[n*cols+m]))return;
  const spans:{start:number;end:number}[]=Array(n);let j=m;
  for(let i=n;i>0;i--){const k=trace[i*cols+j];if(!k)return;spans[i-1]={start:groups[j-k].start,end:groups[j-1].end};j-=k;}
  return [0,...spans.slice(1).map((value,index)=>(spans[index].end+value.start)/2/width),1];
  }finally{gray.fill(0);}
}
/** Real CTC intervals delimit approximate regions; these are never advertised as measured glyph boxes. */
export function paddleCTCRegions(result:PaddleRecResult,projection:TextProjection,rotated:boolean,reversed:boolean,pixels?:AlignmentPixels):CTCTextRegion[]|undefined {
  const input=result.input;
  if(projection.length!==9||!projection.every(Number.isFinite)||!input||result.alignment!=='ctc-approximate'||!Number.isSafeInteger(result.timeSteps)||result.timeSteps<1||
    !Number.isSafeInteger(input.width)||!Number.isSafeInteger(input.contentWidth)||input.contentWidth<1||input.width<input.contentWidth||
    result.glyphs.length<1||result.glyphs.length>4096||result.glyphs.map(value=>value.text).join('')!==result.text)return;
  let offset=0,previous=0;
  const glyphs=[] as {glyph:PaddleRecResult['glyphs'][number];start:number;end:number}[];
  for(const glyph of result.glyphs){
    if(!glyph.text||!Number.isSafeInteger(glyph.start)||!Number.isSafeInteger(glyph.end)||glyph.start<previous||glyph.end<=glyph.start||glyph.end>result.timeSteps||
      !Number.isFinite(glyph.confidence)||glyph.confidence<0||glyph.confidence>1.00001)return;
    const start=offset;offset+=glyph.text.length;previous=glyph.end;
    if(glyph.text.trim())glyphs.push({glyph,start,end:offset});
  }
  if(!glyphs.length)return;
  const scale=input.width/input.contentWidth/result.timeSteps;
  // Emissions in padded columns do not locate text in the source image.
  if(glyphs.some(({glyph})=>(glyph.start+glyph.end)*.5*scale>1))return;
  const edges=pixels&&inkEdges(pixels,glyphs,scale)||[0,...glyphs.slice(1).map(({glyph},index)=>(glyphs[index].glyph.end+glyph.start)*.5*scale),1];
  if(edges.some((value,index)=>!Number.isFinite(value)||value<0||value>1||index>0&&value<=edges[index-1]))return;
  const point=(u:number,v:number)=>{
    if(reversed){u=1-u;v=1-v;}
    if(rotated)[u,v]=[1-v,u];
    return projectPaddlePoint(projection,u,v);
  };
  return glyphs.map(({glyph,start,end},index)=>({text:glyph.text,start,end,confidence:Math.min(1,glyph.confidence)*100,
    quad:[point(edges[index],0),point(edges[index+1],0),point(edges[index+1],1),point(edges[index],1)]}));
}
export function applyPaddleCTCRegions(document:TextDocument,regions:readonly (readonly CTCTextRegion[]|undefined)[]){
  const segmenter=new Intl.Segmenter(document.language==='eng'?'en':'zh',{granularity:'word'});
  let order=0,index=0,remaining=document.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens)).length;
  if(remaining!==regions.length)return;
  for(const line of document.blocks.flatMap(block=>block.lines)){
    line.tokens=line.tokens.flatMap(base=>{
      const parts=regions[index++];
      remaining--;
      if(base.sourceStart===undefined||!parts?.length||order+parts.length+remaining>200000){base.order=order++;return [base];}
      const segments=[...segmenter.segment(base.text)];
      return parts.map((part,partIndex)=>({id:base.id+':ctc:'+partIndex,
        wordId:base.wordId+':'+(segments.find(value=>value.index<=part.start&&value.index+value.segment.length>part.start)?.index??part.start),
        lineId:base.lineId,order:order++,text:part.text,quad:part.quad,geometry:'ctc',confidence:part.confidence,
        sourceStart:base.sourceStart!+part.start,sourceEnd:base.sourceStart!+part.end,
        separatorAfter:base.text.slice(part.end,parts[partIndex+1]?.start??base.text.length)+(partIndex===parts.length-1?base.separatorAfter:'')}));
    });
  }
}
