import {extractImagePalette} from '../shared/image-palette';

self.onmessage=(event:MessageEvent<{id:number;bitmap:ImageBitmap}>)=>{
 const {id,bitmap}=event.data;
 try{
  const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('无法读取图片像素');
  context.drawImage(bitmap,0,0,width,height);
  const colors=extractImagePalette(context.getImageData(0,0,width,height).data,width,height);
  self.postMessage({id,colors});
 }catch(error){self.postMessage({id,error:(error as Error).message});}
 finally{bitmap.close();}
};
