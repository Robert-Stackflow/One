import { OCR_TEXT, type OCRResult } from './ocr';
import { ocrRect, type OCRRect } from './ocr-tiles';
import { readingTokens, textBounds, selectedText, type TextDocument, type TextLine, type TextToken, type TextQuad } from './text-document';
import { ocrWordGroups, ocrTokenBounds, validateOCRSelection } from './text-region';

export interface OCRRectangleSelection { revision:number; region:OCRRect }
export type OCRLocalSelection=import('./text-region').OCRRegionSelection|OCRRectangleSelection;
type Group=ReturnType<typeof ocrWordGroups>[number];
type Box=ReturnType<typeof textBounds>;
const intersects=(box:Box,rect:OCRRect)=>box.x<rect.left+rect.width&&box.x+box.width>rect.left&&box.y<rect.top+rect.height&&box.y+box.height>rect.top;
const contains=(rect:OCRRect,x:number,y:number)=>x>=rect.left&&x<=rect.left+rect.width&&y>=rect.top&&y<=rect.top+rect.height;
const covers=(box:Box,x:number,y:number)=>x>=box.x-2&&x<=box.x+box.width+2&&y>=box.y-2&&y<=box.y+box.height+2;
const quad=(box:Box):TextQuad=>[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}];
function direction(axis?:TextQuad){const x=axis?axis[1].x-axis[0].x:1,y=axis?axis[1].y-axis[0].y:0,length=Math.hypot(x,y)||1;return {x:x/length,y:y/length};}
function span(tokens:TextToken[],axis:{x:number;y:number}){
  let start=Infinity,end=-Infinity,crossStart=Infinity,crossEnd=-Infinity;
  for(const token of tokens)for(const shape of token.sourceQuads||[token.quad])for(const point of shape){
    const along=point.x*axis.x+point.y*axis.y,across=-point.x*axis.y+point.y*axis.x;
    start=Math.min(start,along);end=Math.max(end,along);crossStart=Math.min(crossStart,across);crossEnd=Math.max(crossEnd,across);
  }
  return {start,end,crossStart,crossEnd};
}
export function prepareOCRRectangle(base:OCRResult|undefined,size:{width:number;height:number},value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'revision')||!Object.hasOwn(value,'region'))throw Error('框选识别区域无效');
  const selection=value as OCRRectangleSelection;
  if(!Number.isSafeInteger(selection.revision)||selection.revision<0||selection.revision!==(base?.document?.revision||0))throw Error('识别结果已改变，请重新框选');
  const requested=ocrRect(selection.region,size),document=base?.document,tokens=document?readingTokens(document):[];
  if(base?.text.trim()&&!tokens.length)throw Error('当前结果没有字词坐标，不能合并区域；原文已保留');
  if(tokens.length)validateOCRSelection(base!,{revision:selection.revision,anchor:0,focus:0});
  if(document&&(document.source.width!==size.width||document.source.height!==size.height))throw Error('框选原图尺寸不一致');
  if((document?.revisions?.length||0)>=64)throw Error('局部识别次数已满，请重新识别全文');
  const chosen=document?ocrWordGroups(document).filter(group=>group.tokens.some(token=>(token.sourceQuads||[token.quad]).some(shape=>intersects(textBounds(shape),requested)))):[];
  if(chosen.length>1024)throw Error('区域文字过多，请缩小框选或识别全文');
  const box=chosen.length?ocrTokenBounds(chosen.flatMap(group=>group.tokens)):undefined;
  const left=Math.max(0,Math.floor(Math.min(requested.left,box?.x??requested.left))),top=Math.max(0,Math.floor(Math.min(requested.top,box?.y??requested.top)));
  const right=Math.min(size.width,Math.ceil(Math.max(requested.left+requested.width,box?box.x+box.width:0))),bottom=Math.min(size.height,Math.ceil(Math.max(requested.top+requested.height,box?box.y+box.height:0)));
  const core={left,top,width:right-left,height:bottom-top},padding=32,x=Math.max(0,left-padding),y=Math.max(0,top-padding);
  const context={left:x,top:y,width:Math.min(size.width,right+padding)-x,height:Math.min(size.height,bottom+padding)-y};
  return {selection:{revision:selection.revision,region:requested},core,context,chosen:new Set(chosen.map(group=>group.key))};
}

/** Replace only words touched by the rectangle; new detections can fill previously unrecognized areas. */
export function replaceOCRRectangle(base:OCRResult|undefined,patch:OCRResult,selection:OCRRectangleSelection):OCRResult{
  const area=prepareOCRRectangle(base,{width:patch.width,height:patch.height},selection),incoming=patch.document;
  if(!incoming||incoming.source.width!==patch.width||incoming.source.height!==patch.height||(base?.document&&incoming.source.sha256!==base.document.source.sha256))throw Error('框选识别的原图或坐标不一致，原文已保留');
  const previous=base?.document&&readingTokens(base.document).length?base.document:undefined,before=previous?ocrWordGroups(previous):[],chosen=before.filter(group=>area.chosen.has(group.key)),outside=before.filter(group=>!area.chosen.has(group.key)&&intersects(group.box,area.core));
  const incomingGroups=ocrWordGroups(incoming);
  if(outside.length>2048||incomingGroups.length>8192)throw Error('区域文字过密，请缩小框选；原文已保留');
  const accepted=incomingGroups.filter(group=>{
    const x=group.box.x+group.box.width/2,y=group.box.y+group.box.height/2;
    return contains(area.core,x,y)&&(contains(selection.region,x,y)||chosen.some(old=>covers(old.box,x,y)))&&!outside.some(old=>covers(old.box,x,y));
  });
  if(outside.length>2048||accepted.length>4096)throw Error('区域文字过密，请缩小框选；原文已保留');
  if(!accepted.length)throw Error('该区域未识别到可用文字，原文已保留');
  const revision=(base?.document?.revision||0)+1;
  const incomingLines=new Map<string,{block:number;order:number}>();incoming.blocks.forEach((block,index)=>block.lines.forEach(line=>incomingLines.set(line.id,{block:index,order:line.order})));
  interface Row {line:TextLine;block:number;box:Box;groups:Group[];axis:{x:number;y:number};span:ReturnType<typeof span>;sourceOrder?:number;added:boolean;changed:boolean}
  const rows:Row[]=[];
  const byLine=new Map<string,Group[]>();for(const group of before){const groups=byLine.get(group.line)||[];groups.push(group);byLine.set(group.line,groups);}
  previous?.blocks.forEach((block,index)=>block.lines.forEach(line=>{
    const groups=byLine.get(line.id)||[];
    const axis=direction(line.tokens[0]?.sourceQuads?.[0]||line.tokens[0]?.quad);
    rows.push({line:{...line,quad:structuredClone(line.quad),tokens:[]},block:index,box:textBounds(line.quad),axis,span:span(line.tokens,axis),groups:groups.filter(group=>!area.chosen.has(group.key)).map(group=>structuredClone(group)),added:false,changed:groups.some(group=>area.chosen.has(group.key))});
  }));
  const candidates=rows.filter(row=>intersects(row.box,area.context));
  if(candidates.length>2048)throw Error('区域行数过多，请缩小框选；原文已保留');
  const added=new Map<string,Row>(),byTop=[...rows].sort((a,b)=>a.box.y-b.box.y);
  const distance=(box:Box,x:number,y:number)=>Math.max(box.y-y,0,y-box.y-box.height)*4+Math.max(box.x-x,0,x-box.x-box.width);
  for(const group of accepted){
    const x=group.box.x+group.box.width/2,y=group.box.y+group.box.height/2;
    let target:Row|undefined,best=Infinity;
    for(const row of candidates){const along=x*row.axis.x+y*row.axis.y,across=-x*row.axis.y+y*row.axis.x;
      const thickness=Math.max(1,row.span.crossEnd-row.span.crossStart,Math.abs(row.axis.y)*group.box.width+Math.abs(row.axis.x)*group.box.height);
      const crossGap=Math.max(row.span.crossStart-across,0,across-row.span.crossEnd),alongGap=Math.max(row.span.start-along,0,along-row.span.end);
      if(crossGap>thickness*.5||alongGap>thickness*4)continue;const score=crossGap*4+alongGap;if(score<best){target=row;best=score;}}
    if(!target){
      target=added.get(group.line);
      if(!target){
        let low=0,high=byTop.length;while(low<high){const mid=(low+high)>>>1;if(byTop[mid].box.y<y)low=mid+1;else high=mid;}
        const nearby=byTop.slice(Math.max(0,low-16),low+16).sort((a,b)=>distance(a.box,x,y)-distance(b.box,x,y));
        const axis=direction(group.tokens[0]?.quad);
        target={line:{id:`r${revision}:${group.line}`,order:0,quad:quad(group.box),tokens:[]},block:previous?(nearby[0]?.block||0):(incomingLines.get(group.line)?.block||0),box:{...group.box},axis,span:span(group.tokens,axis),sourceOrder:incomingLines.get(group.line)?.order,groups:[],added:true,changed:true};added.set(group.line,target);
      }
    }
    const next:Group={...group,key:`r${revision}:${group.key}`,line:target.line.id,tokens:group.tokens.map(token=>({...structuredClone(token),id:`r${revision}:${token.id}`,wordId:`r${revision}:${token.wordId}`,lineId:target!.line.id,recognitionRevision:revision}))};
    const {x:dx,y:dy}=target.axis;
    const position=(box:Box)=>(box.x+box.width/2)*dx+(box.y+box.height/2)*dy;
    const index=target.groups.findIndex(old=>position(old.box)>position(next.box));
    target.groups.splice(index<0?target.groups.length:index,0,next);target.changed=true;
  }
  const doc:TextDocument=structuredClone({...previous||incoming,blocks:[]});
  if(previous)doc.blocks=previous.blocks.map(block=>structuredClone({...block,lines:[]}));
  else doc.blocks=incoming.blocks.map(block=>structuredClone({...block,id:`r${revision}:${block.id}`,lines:[]}));
  if(!doc.blocks.length)doc.blocks=[{id:`r${revision}:b0`,order:0,quad:quad(accepted[0].box),lines:[]}];
  for(const block of doc.blocks)block.lines=[];
  const rowsByBlock=new Map<number,Row[]>(),newByBlock=new Map<number,Row[]>();
  for(const row of rows){const list=rowsByBlock.get(row.block)||[];list.push(row);rowsByBlock.set(row.block,list);}
  for(const row of added.values()){const list=newByBlock.get(row.block)||[];list.push(row);newByBlock.set(row.block,list);}
  for(let index=0;index<doc.blocks.length;index++){
    const ordered=rowsByBlock.get(index)||[],newRows=(newByBlock.get(index)||[]).sort((a,b)=>previous?a.box.y-b.box.y:(a.sourceOrder||0)-(b.sourceOrder||0));
    if(!previous)ordered.push(...newRows);
    else for(const row of newRows){const across=(box:Box)=>-(box.x+box.width/2)*row.axis.y+(box.y+box.height/2)*row.axis.x;const at=ordered.findIndex(old=>across(old.box)>across(row.box));ordered.splice(at<0?ordered.length:at,0,row);}
    for(const row of ordered){if(!row.groups.length)continue;row.line.tokens=row.groups.flatMap(group=>group.tokens);if(row.changed)row.line.quad=quad(ocrTokenBounds(row.line.tokens));doc.blocks[index].lines.push(row.line);}
    if(ordered.some(row=>row.changed)&&doc.blocks[index].lines.length)doc.blocks[index].quad=quad(ocrTokenBounds(doc.blocks[index].lines.flatMap(line=>line.tokens)));
  }
  doc.blocks=doc.blocks.filter(block=>block.lines.length);
  let lineOrder=0;doc.blocks.forEach((block,index)=>{block.order=index;block.lines.forEach(line=>line.order=lineOrder++);});
  const original=previous?readingTokens(previous):[],start=original[0]?.sourceStart,end=original.at(-1)?.sourceEnd;
  let text=start===undefined?'':base!.text.slice(0,start),order=0;
  const trailing=end===undefined?'':base!.text.slice(end),all=doc.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens));
  for(let index=0;index<all.length;index++){
    const token=all[index],next=all[index+1];token.order=order++;token.sourceStart=text.length;text+=token.text;token.sourceEnd=text.length;
    if(!next)token.separatorAfter=trailing;
    else if(token.lineId!==next.lineId)token.separatorAfter=token.separatorAfter.includes('\n')?token.separatorAfter:'\n';
    else if(token.wordId!==next.wordId){if(token.separatorAfter.includes('\n'))token.separatorAfter=' ';else if(!token.separatorAfter&&(token.recognitionRevision===revision||next.recognitionRevision===revision)&&!/[\p{Script=Han}（(]$/u.test(token.text)&&!(/^[\p{Script=Han}，。！？、；：,.!?;:)]/u.test(next.text)))token.separatorAfter=' ';}
    text+=token.separatorAfter;if(text.length>OCR_TEXT||order>200000)throw Error('框选识别结果过多，原文已保留');
  }
  doc.text=text;doc.alignment='source';doc.revision=revision;doc.id=doc.id.replace(/:r\d+$/,'')+`:r${revision}`;
  doc.revisions=[...(previous?.revisions||[]),{revision,kind:'rectangle',requested:area.selection.region,region:area.core,context:area.context,contextToSource:[1,0,0,1,area.context.left,area.context.top],engine:structuredClone(incoming.engine),language:incoming.language}];
  const locations=new Map<string,{block:number;line:number}>();doc.blocks.forEach((block,b)=>block.lines.forEach((line,l)=>locations.set(line.id,{block:b,line:l})));
  const words=ocrWordGroups(doc).map(group=>({...group.box,text:selectedText(group.tokens,0,group.tokens.length-1),confidence:0,...locations.get(group.line)!}));
  return {...(previous?base!:patch),text,words,confidence:0,document:doc,inference:patch.inference};
}
