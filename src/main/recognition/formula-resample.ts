/** RGB8 resampling derived from Pillow 12.3.0 Resample.c, Reduce.c and Image.thumbnail.
 * Source: https://github.com/python-pillow/Pillow/tree/bb1d8e8ab8d29048624d96e3ee53cecf7c13d13d
 * Copyright Secret Labs AB, Fredrik Lundh, Jeffrey A. Clark and contributors.
 * MIT-CMU terms: assets/licenses/pillow-LICENSE.txt. Only the formula input path uses this.
 */
interface RGB {data:Uint8Array;width:number;height:number}
const precision=1<<22,half=precision/2,f32=Math.fround;
type Filter='linear'|'cubic';
function coefficients(input:number,start:number,end:number,output:number,filter:Filter){
  start=f32(start);end=f32(end);
  const scale=f32(end-start)/output,stretch=Math.max(1,scale),support=(filter==='linear'?1:2)*stretch,inverse=1/stretch;
  return Array.from({length:output},(_,index)=>{
    const center=start+(index+.5)*scale,left=Math.max(0,Math.trunc(center-support+.5)),right=Math.min(input,Math.trunc(center+support+.5));
    const weights=new Float64Array(right-left);let total=0;
    for(let at=0;at<weights.length;at++){
      const x=Math.abs((at+left-center+.5)*inverse);
      const value=filter==='linear'?Math.max(0,1-x):x<1?((1.5*x-2.5)*x*x+1):x<2?(((x-5)*x+8)*x-4)*-.5:0;
      weights[at]=value;total+=value;
    }
    return {left,weights:Int32Array.from(weights,value=>{const scaled=(total?value/total:value)*precision;return Math.trunc(scaled+(scaled<0?-.5:.5));})};
  });
}
const clip=(value:number)=>Math.max(0,Math.min(255,Math.floor(value/precision)));
function resize(image:RGB,width:number,height:number,filter:Filter,right=image.width,bottom=image.height):RGB {
  let horizontal=image.data;
  if(width!==image.width||right!==image.width){
    const rows=coefficients(image.width,0,right,width,filter);horizontal=new Uint8Array(width*image.height*3);
    for(let y=0;y<image.height;y++)for(let x=0;x<width;x++){
      const row=rows[x];let r=half,g=half,b=half;
      for(let i=0;i<row.weights.length;i++){const at=(y*image.width+row.left+i)*3,k=row.weights[i];r+=image.data[at]*k;g+=image.data[at+1]*k;b+=image.data[at+2]*k;}
      const at=(y*width+x)*3;horizontal[at]=clip(r);horizontal[at+1]=clip(g);horizontal[at+2]=clip(b);
    }
  }
  if(height===image.height&&bottom===image.height)return {data:horizontal===image.data?horizontal.slice():horizontal,width,height};
  const rows=coefficients(image.height,0,bottom,height,filter),data=new Uint8Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const row=rows[y];let r=half,g=half,b=half;
    for(let i=0;i<row.weights.length;i++){const at=((row.left+i)*width+x)*3,k=row.weights[i];r+=horizontal[at]*k;g+=horizontal[at+1]*k;b+=horizontal[at+2]*k;}
    const at=(y*width+x)*3;data[at]=clip(r);data[at+1]=clip(g);data[at+2]=clip(b);
  }
  if(horizontal!==image.data)horizontal.fill(0);return {data,width,height};
}
function reduce(image:RGB,fx:number,fy:number):RGB {
  const width=Math.ceil(image.width/fx),height=Math.ceil(image.height/fy),data=new Uint8Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const endX=Math.min(image.width,(x+1)*fx),endY=Math.min(image.height,(y+1)*fy),count=(endX-x*fx)*(endY-y*fy);
    const multiplier=Math.trunc(f32(4294967296/f32(256*count))),amend=Math.floor(count/2);let r=amend,g=amend,b=amend;
    for(let yy=y*fy;yy<endY;yy++)for(let xx=x*fx;xx<endX;xx++){const at=(yy*image.width+xx)*3;r+=image.data[at];g+=image.data[at+1];b+=image.data[at+2];}
    const at=(y*width+x)*3;data[at]=Math.floor(r*multiplier/16777216);data[at+1]=Math.floor(g*multiplier/16777216);data[at+2]=Math.floor(b*multiplier/16777216);
  }
  return {data,width,height};
}
function thumbnailSize(width:number,height:number){
  const aspect=width/height;
  const rounded=(value:number,error:(n:number)=>number)=>{const low=Math.floor(value),high=Math.ceil(value);return Math.max(1,error(low)<=error(high)?low:high);};
  return aspect<=1?{width:rounded(384*aspect,n=>Math.abs(aspect-n/384)),height:384}:{width:384,height:rounded(384/aspect,n=>n===0?0:Math.abs(aspect-384/n))};
}
const mean=f32(.7931),deviation=f32(.1738),red=f32(.114),green=f32(.587),blue=f32(.299);
const normalize=(value:number)=>f32(f32(f32(value/255)-mean)/deviation);
const gray=(r:number,g:number,b:number)=>f32(f32(f32(normalize(r)*red)+f32(normalize(g)*green))+f32(normalize(b)*blue));
/** Official two-stage resize, black letterbox and NumPy float32 operation order. */
export function formulaPixels(data:Uint8Array,width:number,height:number){
  const w=width<=height?384:Math.floor(384*width/height),h=height<=width?384:Math.floor(384*height/width);
  if(Math.min(width,height)<2||w*h>8_388_608)throw Error('公式区域过于狭长，请分段裁剪后识别');
  let image=resize({data,width,height},w,h,'linear');
  try{
    const target=thumbnailSize(w,h),fx=Math.max(1,Math.floor(w/target.width/2)),fy=Math.max(1,Math.floor(h/target.height/2));
    if(fx>1||fy>1){const next=reduce(image,fx,fy);image.data.fill(0);image=next;}
    if(image.width!==target.width||image.height!==target.height||w/fx!==image.width||h/fy!==image.height){const next=resize(image,target.width,target.height,'cubic',w/fx,h/fy);image.data.fill(0);image=next;}
    const output=new Float32Array(384*384);output.fill(gray(0,0,0));const dx=Math.floor((384-image.width)/2),dy=Math.floor((384-image.height)/2);
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const at=(y*image.width+x)*3;output[(y+dy)*384+x+dx]=gray(image.data[at],image.data[at+1],image.data[at+2]);}
    return output;
  }finally{image.data.fill(0);}
}
