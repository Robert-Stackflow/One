export interface TileProgress {done:number;total:number}
export type TileInference=(input:Float32Array,width:number,height:number)=>Promise<Float32Array>;

const scale=4,core=128,padding=16;

export async function upscaleRgbTiles(rgb:Buffer,width:number,height:number,infer:TileInference,progress?:(value:TileProgress)=>void):Promise<Buffer>{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>2048||height>2048||width*height>1_000_000||rgb.length!==width*height*3)throw Error('超分输入尺寸无效或超过 100 万像素');
 const output=Buffer.allocUnsafe(width*height*3*scale*scale),columns=Math.ceil(width/core),rows=Math.ceil(height/core),total=columns*rows;
 for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
  const x=column*core,y=row*core,copyWidth=Math.min(core,width-x),copyHeight=Math.min(core,height-y);
  const left=Math.max(0,x-padding),top=Math.max(0,y-padding),right=Math.min(width,x+copyWidth+padding),bottom=Math.min(height,y+copyHeight+padding),tileWidth=right-left,tileHeight=bottom-top;
  const pixels=tileWidth*tileHeight,input=new Float32Array(pixels*3);
  for(let py=0;py<tileHeight;py++)for(let px=0;px<tileWidth;px++){
   const src=((top+py)*width+left+px)*3,index=py*tileWidth+px;
   input[index]=rgb[src]/255;input[pixels+index]=rgb[src+1]/255;input[pixels*2+index]=rgb[src+2]/255;
  }
  const result=await infer(input,tileWidth,tileHeight),resultWidth=tileWidth*scale,resultPixels=resultWidth*tileHeight*scale;
  if(!(result instanceof Float32Array)||result.length!==resultPixels*3)throw Error('超分模型输出尺寸无效');
  const offsetX=(x-left)*scale,offsetY=(y-top)*scale;
  for(let py=0;py<copyHeight*scale;py++)for(let px=0;px<copyWidth*scale;px++){
   const index=(offsetY+py)*resultWidth+offsetX+px,target=((y*scale+py)*width*scale+x*scale+px)*3;
   for(let channel=0;channel<3;channel++){
    const value=result[channel*resultPixels+index];
    if(!Number.isFinite(value))throw Error('超分模型输出包含无效像素');
    output[target+channel]=Math.max(0,Math.min(255,Math.round(value*255)));
   }
  }
  progress?.({done:row*columns+column+1,total});
 }
 return output;
}
