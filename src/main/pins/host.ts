import {clipboard,dialog,type BrowserWindow} from 'electron';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {readClipboardFiles} from '../file-clipboard';
import {readClipboardPng} from '../capture/clipboard';
import type {MaterialsService} from '../materials/service';
import {PinService,type PinContext} from './service';
import type {PinPlacement} from '../../shared/pins';
import type {PinAction,PinGroupAction} from '../../shared/pins';

export class PinsHost {
  readonly service:PinService;
  private ready:Promise<void>;
  private tasks=new Set<Promise<unknown>>();
  private closing=false;
  private stopping?:Promise<void>;
  constructor(directory:string,private materials:MaterialsService,private context:PinContext,changed:()=>void,failed:(error:unknown)=>void){
    this.service=new PinService(directory,changed,file=>{
      materials.library.protect(file);
      const local=relative(resolve(directory),resolve(file));
      if(!local||!isAbsolute(local)&&local!=='..'&&!local.startsWith('..'+sep))throw Error('请选择贴图存储目录之外的位置');
    },failed,context);
    this.ready=this.service.init();void this.ready.catch(failed);
  }
  private run<T>(work:()=>Promise<T>):Promise<T>{
    if(this.closing||this.context.blocked())return Promise.reject(Error('贴图服务已关闭'));
    const task=this.ready.then(work);this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;
  }
  state(){return this.run(async()=>this.service.workspace());}
  preview(id:string){return this.run(()=>this.service.preview(id));}
  action(id:string,action:PinAction){return this.run(()=>this.service.action(id,action));}
  group(id:string|null,action:PinGroupAction){return this.run(()=>this.service.group(id,action));}
  toggle(){return this.run(()=>this.service.toggleAll());}
  nextGroup(){return this.run(()=>this.service.nextGroup());}
  material(id:string){return this.run(async()=>{await this.materials.initialized();const item=this.materials.library.images.get(id);return this.service.open({title:item.title.slice(0,120),png:await this.materials.library.images.read(id)});});}
  image(title:string,png:Buffer,captured?:PinPlacement){return this.run(()=>this.service.open({title,png,captured}));}
  clipboard(){return this.run(async()=>{
    const files=readClipboardFiles();if(files.length)return this.service.open({title:files.length===1?basename(files[0]).slice(0,120):`${files.length} 个文件`,files,reuseClipboard:true});
    const png=await readClipboardPng();if(png)return this.service.open({title:'剪贴板图片',png,reuseClipboard:true});
    const text=await clipboard.readText();if(!text.trim())throw Error('剪贴板中没有可贴出的图片、文字或文件');
    if(text.length>50000)throw Error('文字贴图最多 50,000 字符');return this.service.open({title:'文字贴图',text,reuseClipboard:true});
  });}
  files(parent:BrowserWindow){return this.run(async()=>{
    const result=await dialog.showOpenDialog(parent,{title:'贴出文件',properties:['openFile','multiSelections']});
    if(result.canceled||!result.filePaths.length)return;
    return this.service.open({title:result.filePaths.length===1?basename(result.filePaths[0]).slice(0,120):`${result.filePaths.length} 个文件`,files:result.filePaths});
  });}
  get pendingTasks(){return this.tasks.size;}
  stop(){if(this.stopping)return this.stopping;this.closing=true;return this.stopping=(async()=>{await Promise.allSettled([...this.tasks,this.ready]);await this.service.dispose();})();}
}
