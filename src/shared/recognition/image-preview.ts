export interface OCRImagePreviewRequest { view:number;left:number;top:number;width:number;height:number;downsample:number }
export const OCR_PREVIEW_EDGE=1024;
export function imagePreviewRequest(value:unknown,size:{width:number;height:number}):OCRImagePreviewRequest{
  const v=value as OCRImagePreviewRequest;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='downsample,height,left,top,view,width'||
    ![v.view,v.left,v.top,v.width,v.height,v.downsample].every(Number.isSafeInteger)||v.view<0||v.view>0x7fffffff||
    v.left<0||v.top<0||v.width<1||v.height<1||v.left+v.width>size.width||v.top+v.height>size.height||
    v.downsample<1||v.downsample>64||Math.ceil(v.width/v.downsample)>OCR_PREVIEW_EDGE||Math.ceil(v.height/v.downsample)>OCR_PREVIEW_EDGE)
    throw Error('图片预览范围无效');
  return {view:v.view,left:v.left,top:v.top,width:v.width,height:v.height,downsample:v.downsample};
}
export const needsImagePreview=(size:{width:number;height:number})=>size.width>2048||size.height>2048||size.width*size.height>4_000_000;
export interface ImageTilePlan { key:string;region:Omit<OCRImagePreviewRequest,'view'>;core:{left:number;top:number;width:number;height:number};required:boolean }
export function imageTilePlan(size:{width:number;height:number},bounds:{left:number;top:number;right:number;bottom:number},scale:number,density:number):ImageTilePlan[]{
  if(![scale,density,bounds.left,bounds.top,bounds.right,bounds.bottom].every(Number.isFinite)||scale<=0||density<=0)return [];
  const left=Math.max(0,bounds.left),top=Math.max(0,bounds.top),right=Math.min(size.width,bounds.right),bottom=Math.min(size.height,bounds.bottom);
  if(right<=left||bottom<=top)return [];
  let factor=Math.max(1,Math.min(32,2**Math.floor(Math.log2(1/(scale*density))))),edge=512*factor;
  let x0=0,y0=0,x1=0,y1=0;
  do{
    edge=512*factor;x0=Math.max(0,Math.floor(left/edge)-1);y0=Math.max(0,Math.floor(top/edge)-1);
    x1=Math.min(Math.ceil(size.width/edge)-1,Math.floor((right-.00001)/edge)+1);y1=Math.min(Math.ceil(size.height/edge)-1,Math.floor((bottom-.00001)/edge)+1);
    if((x1-x0+1)*(y1-y0+1)<=64||factor>=32)break;factor*=2;
  }while(true);
  const output:ImageTilePlan[]=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const core={left:x*edge,top:y*edge,width:Math.min(edge,size.width-x*edge),height:Math.min(edge,size.height-y*edge)};
    const rx=Math.max(0,core.left-3*factor),ry=Math.max(0,core.top-3*factor);
    output.push({key:`${factor}:${x}:${y}`,core,required:core.left<right&&core.top<bottom&&core.left+core.width>left&&core.top+core.height>top,
      region:{left:rx,top:ry,width:Math.min(size.width,core.left+core.width+3*factor)-rx,height:Math.min(size.height,core.top+core.height+3*factor)-ry,downsample:factor}});
  }
  return output.sort((a,b)=>Number(b.required)-Number(a.required));
}
