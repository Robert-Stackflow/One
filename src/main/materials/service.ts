import {dialog,nativeImage,shell,type BrowserWindow} from 'electron';
import {readFile,stat} from 'node:fs/promises';
import {basename,parse} from 'node:path';
import {imageSize} from 'image-size';
import {IMAGE_BYTES,imageDimensions} from '../../shared/capture/image-limits';
import type {MaterialsState} from '../../shared/materials';
import {readClipboardPng,writeClipboardPng} from '../capture/clipboard';
import {MaterialLibrary} from './library';
import {MaterialResources} from './resources';
import {atomicWrite} from './atomic-file';

interface Context {window(owner:number):BrowserWindow|undefined;changed():void}
/** Application service; One owns its profile, windows, IPC, session and exit. */
export class MaterialsService {
  readonly library:MaterialLibrary;
  readonly resources:MaterialResources;
  private ready:Promise<void>;
  private error='';
  private closing=false;
  private tasks=new Set<Promise<unknown>>();
  private queue:Promise<unknown>=Promise.resolve();
  constructor(directory:string,private context:Context){
    this.library=new MaterialLibrary(directory,png=>{
      const image=nativeImage.createFromBuffer(png),size=image.getSize();
      if(image.isEmpty())throw Error('无法读取图片');
      const factor=Math.min(240/size.width,180/size.height,1);
      return image.resize({width:Math.max(1,Math.round(size.width*factor)),height:Math.max(1,Math.round(size.height*factor)),quality:'good'}).toPNG();
    },()=>{this.resources.prune();if(!this.closing)this.context.changed();});
    this.resources=new MaterialResources(this.library,id=>!this.closing&&!!this.context.window(id));
    this.ready=this.library.init();void this.ready.catch(error=>{this.error=error instanceof Error?error.message:String(error);});
  }
  get pendingTasks(){return this.tasks.size;}
  private owner(id:number){const window=this.context.window(id);if(this.closing||!window||window.isDestroyed()||window.webContents.isDestroyed())throw Error('素材窗口已关闭');return window;}
  private run<T>(owner:number,work:()=>Promise<T>):Promise<T>{
    this.owner(owner);
    const task=this.queue.catch(()=>{}).then(async()=>{await this.ready;this.owner(owner);return work();});
    this.queue=task;this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;
  }
  async state(owner:number):Promise<MaterialsState>{
    this.owner(owner);await this.ready.catch(()=>{});this.owner(owner);
    return {directory:this.library.directory,error:this.error,
      images:this.error?[]:this.library.images.list().map(item=>({...item,thumbnail:this.resources.url(owner,item.id,'image-thumbnail')})),
      recordings:this.error?[]:this.library.list().map(item=>({...item,thumbnail:this.resources.url(owner,item.id,'recording-thumbnail')}))};
  }
  async imageURL(owner:number,id:string){await this.ready;this.owner(owner);return this.resources.url(owner,id,'image');}
  async recordingURL(owner:number,id:string){await this.ready;this.owner(owner);return this.resources.url(owner,id,'recording');}
  importImages(owner:number){return this.run(owner,async()=>{
    const answer=await dialog.showOpenDialog(this.owner(owner),{title:'导入图片',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','bmp']}]});
    if(answer.canceled)return [];this.owner(owner);
    if(answer.filePaths.length>20)throw Error('一次最多导入 20 张图片');
    const ids:string[]=[];
    for(const file of answer.filePaths){
      this.owner(owner);const info=await stat(file);
      if(!info.isFile()||info.size<1||info.size>IMAGE_BYTES)throw Error('图片文件大小无效');
      const bytes=await readFile(file);if(bytes.length>IMAGE_BYTES)throw Error('图片文件大小无效');
      const size=imageSize(bytes);if(!['png','jpg','jpeg','webp','bmp'].includes(size.type||''))throw Error('支持 PNG、JPEG、WebP 和 BMP 图片');
      imageDimensions(size.width,size.height);const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('无法读取图片');
      imageDimensions(image.getSize().width,image.getSize().height);this.owner(owner);
      ids.push((await this.library.images.add(image.toPNG(),basename(file),'file')).id);
    }
    return ids;
  });}
  importClipboard(owner:number){return this.run(owner,async()=>{
    const png=await readClipboardPng();if(!png)throw Error('剪贴板中没有图片');this.owner(owner);
    return (await this.library.images.add(png,'剪贴板图片','clipboard')).id;
  });}
  copyImage(owner:number,id:string){return this.run(owner,async()=>{const png=await this.library.images.read(id);this.owner(owner);await writeClipboardPng(png);});}
  exportImage(owner:number,id:string){return this.run(owner,async()=>{
    const item=this.library.images.get(id),name=parse(item.title).name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)||'图片';
    const answer=await dialog.showSaveDialog(this.owner(owner),{title:'导出图片',defaultPath:name+'.png',filters:[{name:'PNG 图片',extensions:['png']}]});
    if(answer.canceled||!answer.filePath)return false;this.owner(owner);this.library.protect(answer.filePath);
    const png=await this.library.images.read(id);this.owner(owner);await atomicWrite(answer.filePath,png);return true;
  });}
  removeImage(owner:number,id:string){return this.run(owner,()=>this.library.removeImage(id));}
  removeRecording(owner:number,id:string){return this.run(owner,()=>this.library.removeRecording(id));}
  openDirectory(owner:number){return this.run(owner,async()=>{const error=await shell.openPath(this.library.directory);if(error)throw Error(error);});}
  release(owner:number){this.resources.release(owner);}
  async stop(){this.closing=true;this.resources.clear();await Promise.allSettled([...this.tasks,this.ready]);}
}
