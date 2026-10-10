import {imageSize} from 'image-size';
import {prepareZXingModule,readBarcodes} from 'zxing-wasm/reader';
import wasmURL from 'zxing-wasm/reader/zxing_reader.wasm?url';
import {barcodeLimits,type BarcodeDecoded,type BarcodeResult} from '../shared/barcode';
const scope=self as unknown as {onmessage:((event:MessageEvent<Uint8Array>)=>void)|null;postMessage(value:unknown):void};
prepareZXingModule({overrides:{locateFile:()=>wasmURL}});
scope.onmessage=async event=>{
 const started=performance.now();let bitmap:ImageBitmap|undefined;
 try{const bytes=event.data;if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>barcodeLimits.bytes)throw Error('图片文件不能超过 32 MB');let size:ReturnType<typeof imageSize>;try{size=imageSize(bytes);}catch{throw Error('无法读取图片：文件损坏或不是受支持的图片');}
  if(!['png','jpg','webp','gif','bmp'].includes(size.type||''))throw Error('图片格式不支持，请使用 PNG、JPEG、WebP、GIF 或 BMP');if(!size.width||!size.height||size.width*size.height>barcodeLimits.pixels||Math.max(size.width,size.height)>barcodeLimits.side)throw Error('图片不能超过 1600 万像素，单边不能超过 16384 像素');
  try{bitmap=await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));}catch{throw Error('无法解码图片，文件可能已损坏');}const {width,height}=bitmap;if(width*height>barcodeLimits.pixels)throw Error('图片超过 1600 万像素');const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('无法初始化图片识别');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0);bitmap.close();bitmap=undefined;
  const raw=await readBarcodes(ctx.getImageData(0,0,width,height),{tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:true,maxNumberOfSymbols:barcodeLimits.symbols+1,returnErrors:true,textMode:'Plain'}),warnings:string[]=[],results:BarcodeResult[]=[];let total=0;
  for(const result of raw){if(!result.isValid){warnings.push(`${result.format}：条码校验失败`);continue;}if(results.length>=barcodeLimits.symbols){warnings.push('条码过多，仅显示前 64 个');break;}total+=result.text.length+result.bytes.length*2;if(result.text.length>barcodeLimits.text||total>barcodeLimits.totalText){warnings.push('部分条码内容超过显示限制');continue;}const p=result.position;results.push({format:result.format,text:result.text,hex:Array.from(result.bytes,b=>b.toString(16).padStart(2,'0')).join(''),contentType:result.contentType,position:[p.topLeft,p.topRight,p.bottomRight,p.bottomLeft],rotation:result.rotation});}
  const decoded:BarcodeDecoded={width,height,results,warnings:[...new Set(warnings)],elapsed:Math.round(performance.now()-started)};scope.postMessage({decoded});
 }catch(error){scope.postMessage({error:error instanceof Error?error.message:'图片识别失败'});}finally{bitmap?.close();}
};
