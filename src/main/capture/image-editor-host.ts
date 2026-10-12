import type {BrowserWindow,IpcMainInvokeEvent} from 'electron';
import {randomUUID} from 'node:crypto';
import {ImageEditorService} from './image-editor';
import {decodePng,writeClipboardPng} from './clipboard';
import type {MaterialsService} from '../materials/service';
import type {ImageProject} from '../../shared/capture/image-project';
import type {CapturePreferences} from '../../shared/capture/settings';
import type {WatermarkPreset} from '../../shared/capture/watermark';
import type {InstalledFont} from '../../shared/fonts';
interface Context {
  createWindow():BrowserWindow;
  register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  settings():CapturePreferences;
  saveWatermark(value:WatermarkPreset):Promise<unknown>;
  fonts():Promise<InstalledFont[]>;
  blocked():boolean;dark():boolean;
}
/** One owns this adapter's windows, registration, settings, and exit sequencing. */
export class ImageEditorHost {
  readonly editor:ImageEditorService;
  private tasks=new Set<Promise<unknown>>();
  private openingMaterials=new Set<string>();
  private confirmation?:{window:BrowserWindow;token:string;finish:(answer:boolean)=>void};
  constructor(private materials:MaterialsService,ctx:Context){
    this.editor=new ImageEditorService({
      ...ctx,background:task=>this.track(task),confirmClose:window=>this.confirm(window),
      uiScale:()=>ctx.settings().uiScale,watermark:()=>ctx.settings().watermark,
      get:async id=>{await materials.initialized();return materials.library.images.detail(id);},
      current:(id,hash)=>{try{return materials.library.images.get(id).hash===hash;}catch{return false;}},
      protect:file=>materials.library.protect(file),
      autosaveProject:(id,project,png)=>materials.library.saveImageProject(id,project,png),
      commit:(id,hash,payload,mode,valid,project,original)=>{
        const item=materials.library.images.get(id);if(item.hash!==hash)throw Error('原图已改变');
        return this.commit('编辑 · '+item.title,payload.png,mode,valid,project,original,'edit');
      },
      commitTransient:(title,payload,mode,valid,project,original)=>this.commit(title,payload.png,mode,valid,project,original,'capture'),
    });
    ctx.register('image-project-close-answer',(event,token,accepted)=>{
      const pending=this.confirmation;
      if(!pending||pending.window.webContents!==event.sender||pending.token!==token||typeof accepted!=='boolean')throw Error('关闭确认已失效');
      pending.finish(accepted);
    });
  }
  private track<T>(task:Promise<T>){this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;}
  private async commit(title:string,base64:string,mode:'copy'|'asset',valid:()=>boolean,project:ImageProject|undefined,original:Buffer|undefined,source:'edit'|'capture'){
    await this.materials.initialized();if(!valid())throw Error('图片编辑已取消');const png=decodePng(base64).data;
    try{
      if(mode==='copy'){await writeClipboardPng(png);return '已复制图片';}
      return (await this.materials.library.images.add(png,title,source,project?.document,original,project?.history)).id;
    }finally{png.fill(0);}
  }
  private confirm(window:BrowserWindow):Promise<boolean>{
    return new Promise(resolve=>{
      const token=randomUUID(),closed=()=>finish(false),finish=(answer:boolean)=>{
        if(this.confirmation?.token!==token)return;this.confirmation=undefined;
        window.removeListener('closed',closed);window.webContents.removeListener('render-process-gone',closed);resolve(answer);
      };
      this.confirmation={window,token,finish};window.once('closed',closed);window.webContents.once('render-process-gone',closed);
      if(window.isMinimized())window.restore();window.show();window.focus();
      window.webContents.send('one:image-project-close-request',token);
    });
  }
  usesMaterial(id:string){return this.openingMaterials.has(id)||this.editor.usesMaterial(id);}
  openMaterial(parent:BrowserWindow,id:string){return this.track((async()=>{
    if(this.openingMaterials.size)throw Error('正在打开图片，请稍后');
    this.openingMaterials.add(id);
    try{await this.materials.initialized();const item=this.materials.library.images.get(id);
      await this.editor.openProject(parent,this.materials.library.imagePath(item.id),id);
    }finally{this.openingMaterials.delete(id);}
  })());}
  openProject(parent:BrowserWindow){return this.track(this.editor.openProject(parent));}
  get pendingTasks(){return this.tasks.size;}
  async prepareQuit(){await Promise.allSettled([...this.tasks]);return this.editor.requestClose();}
  stop(){this.confirmation?.finish(false);this.editor.abort();}
}
