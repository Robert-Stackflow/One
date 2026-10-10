import {open} from 'node:fs/promises';
import {basename} from 'node:path';
import {clipboard,desktopCapturer,screen,type BrowserWindow} from 'electron';
import {barcodeLimits,validateBarcodeCrop,type BarcodeImage,type BarcodeCaptureImage,type BarcodeCrop} from '../shared/barcode';
let fileReads=0;
export async function barcodeFile(path:string):Promise<BarcodeImage>{if(fileReads>=2)throw Error('正在读取其他图片，请稍后重试');fileReads++;try{return await readBarcodeFile(path);}finally{fileReads--;}}
async function readBarcodeFile(path:string):Promise<BarcodeImage>{
 if(typeof path!=='string'||!path||path.length>32768||path.includes('\0'))throw Error('图片路径无效');const file=await open(path,'r');
 try{const stat=await file.stat();if(!stat.isFile()||!stat.size)throw Error('请选择有效图片文件');if(stat.size>barcodeLimits.bytes)throw Error('图片文件不能超过 32 MB');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const read=await file.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}return {name:basename(path),bytes:bytes.subarray(0,offset)};}finally{await file.close();}
}
export async function barcodeClipboard():Promise<BarcodeImage> {
 const items=await clipboard.read();for(const item of items){const type=item.types.find(t=>['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(t));if(!type)continue;const blob=await item.getType(type);if(!('arrayBuffer' in blob)||!blob.size)continue;if(blob.size>barcodeLimits.bytes)throw Error('剪贴板图片不能超过 32 MB');return {name:'剪贴板图片',bytes:new Uint8Array(await blob.arrayBuffer())};}throw Error('剪贴板中没有受支持的图片');
}
export class BarcodeCapture {
 private session:{owner:BrowserWindow;window:BrowserWindow;image:Electron.NativeImage;resolve:(value:BarcodeImage|null)=>void;timer:ReturnType<typeof setTimeout>;ownerClosed:()=>void}|undefined;
 private pending=false;private pendingOwner=-1;private epoch=0;private stopped=false;
 constructor(private create:(bounds:Electron.Rectangle)=>BrowserWindow){}
 private async capture(display:Electron.Display){
  const count=screen.getAllDisplays().length;if(count>16)throw Error('连接屏幕过多，请使用图片识别');const width=Math.round(display.size.width*display.scaleFactor),height=Math.round(display.size.height*display.scaleFactor),scale=Math.min(1,4096/Math.max(width,height),Math.sqrt(barcodeLimits.pixels/Math.max(1,count)/(width*height)));
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.max(2,Math.round(width*scale)),height:Math.max(2,Math.round(height*scale))},fetchWindowIcons:false});const source=sources.find(s=>s.display_id===String(display.id));if(!source||source.thumbnail.isEmpty())throw Error('无法读取当前屏幕，请使用图片或剪贴板识别');return source.thumbnail;
 }
 async start(owner:BrowserWindow):Promise<BarcodeImage|null>{
  if(this.pending||this.session)throw Error('请先完成当前框选');if(this.stopped)throw Error('屏幕识别已关闭');this.pending=true;this.pendingOwner=owner.webContents.id;const epoch=++this.epoch,restore=owner.isVisible();const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());owner.hide();
  try{await new Promise(resolve=>setTimeout(resolve,150));const image=await this.capture(display);if(this.stopped||epoch!==this.epoch||owner.isDestroyed())throw Error('框选已取消');const size=image.getSize();if(size.width*size.height>barcodeLimits.pixels)throw Error('屏幕图片过大');const window=this.create(display.bounds);
   return await new Promise<BarcodeImage|null>(resolve=>{const timer=setTimeout(()=>this.finish(null),60000);const ownerClosed=()=>{if(this.session?.owner===owner)this.finish(null);};this.session={owner,window,image,resolve,timer,ownerClosed};window.once('closed',()=>this.finish(null));window.once('ready-to-show',()=>{if(this.session?.window===window&&!window.isDestroyed()){window.show();window.focus();}});owner.once('closed',ownerClosed);});
  }finally{this.pending=false;this.pendingOwner=-1;if(restore&&!owner.isDestroyed())owner.show();}
 }
 data(sender:number):BarcodeCaptureImage {const s=this.session;if(!s||s.window.webContents.id!==sender)throw Error('框选会话已结束');const size=s.image.getSize();return {bytes:s.image.toPNG(),...size};}
 choose(sender:number,crop:BarcodeCrop|null){const s=this.session;if(!s||s.window.webContents.id!==sender)throw Error('框选会话已结束');if(crop===null){this.finish(null);return;}const size=s.image.getSize(),rect=validateBarcodeCrop(crop,size.width,size.height),bytes=s.image.crop(rect).toPNG();if(bytes.length>barcodeLimits.bytes)throw Error('框选图片不能超过 32 MB');this.finish({name:'屏幕框选',bytes});}
 cancel(owner:number){if(this.pendingOwner===owner)this.epoch++;if(this.session?.owner.webContents.id===owner)this.finish(null);}
 private finish(value:BarcodeImage|null){const s=this.session;if(!s)return;this.session=undefined;s.owner.removeListener('closed',s.ownerClosed);clearTimeout(s.timer);if(!s.window.isDestroyed())s.window.destroy();s.resolve(value);}
 stop(){this.stopped=true;this.finish(null);}
}
