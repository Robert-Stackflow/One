import {screen,desktopCapturer,type BrowserWindow} from 'electron';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {CaptureService,type CaptureHost as CaptureContext} from './service';
import {writeClipboardPng} from './clipboard';
import {saveImage} from './image-export';
import {captureOptions,type CaptureMode,type CaptureOptions} from '../../shared/capture/api';
import {customCaptureFrom,type CustomCapture} from '../../shared/capture/custom-capture';
import type {CapturePreferences} from '../../shared/capture/settings';
import type {MaterialsService} from '../materials/service';
import type {PinsHost} from '../pins/host';
type Context=Pick<CaptureContext,'createWindow'|'register'|'fonts'|'blocked'|'failed'|'timing'|'saveWatermark'|'sensitive'|'cancelWorkflow'|'annotationStyles'|'saveAnnotationStyle'> & {
  settings():CapturePreferences;mainWindow():BrowserWindow|undefined;assertAvailable():void;
  recognize?(png:Buffer):Promise<void>;
  translate?(window:BrowserWindow,png:Buffer,owner:string,target:string):Promise<boolean>;
};
export class CaptureHost {
  readonly service:CaptureService;
  private tasks=new Set<Promise<unknown>>();
  private closing=false;
  private stopping?:Promise<void>;
  constructor(directory:string,private context:Context,materials:MaterialsService,pins:PinsHost){
    const protect=(file:string)=>{materials.library.protect(file);const local=relative(resolve(directory),resolve(file));if(!local||!isAbsolute(local)&&local!=='..'&&!local.startsWith('..'+sep))throw Error('请保存到 One 数据目录之外');};
    this.service=new CaptureService({...context,
      uiScale:()=>context.settings().uiScale,remoteCompatible:()=>context.settings().remoteCompatible,
      watermark:()=>structuredClone(context.settings().watermark),
      workflows:()=>({workflows:context.settings().workflows,workflowId:context.settings().workflowId}),
      archive:async(png,document,original,history)=>{await materials.initialized();await materials.library.images.add(png,'截图 '+new Date().toLocaleString('zh-CN'),'capture',document,original,history);},
      deliver:async(window,png,action,workflow,owner,captured)=>{
        if(context.blocked())throw Error('One 正在退出');
        if(action==='copy')await writeClipboardPng(png);
        else if(action==='pin')await pins.image('截图',png,captured);
        else if(action==='save')return !!await saveImage(window,{payload:{png:png.toString('base64')}},protect,()=>!context.blocked()&&!window.isDestroyed(),{defaultPath:'One-capture.png'});
        else if(action==='ocr'){if(!context.recognize)throw Error('截图文字识别服务尚未接入');await context.recognize(png);}
        else if(action==='translate'){if(!context.translate)throw Error('截图翻译服务尚未接入');return context.translate(window,png,owner!,workflow!.translationTarget??'zh-Hans');}
        return true;
      },
    });
  }
  private check(){if(this.closing||this.context.blocked())throw Error('截图服务已关闭');}
  private run<T>(work:()=>Promise<T>){this.check();this.context.assertAvailable();const task=work();this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;}
  private preferredDisplay(){const main=this.context.mainWindow();return main&&!main.isDestroyed()?screen.getDisplayMatching(main.getBounds()).id:screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;}
  private display(value?:number){if(value===undefined)return this.preferredDisplay();if(!Number.isSafeInteger(value)||!screen.getAllDisplays().some(display=>display.id===value))throw Error('显示器已断开');return value;}
  private windows(options?:CaptureOptions){const value=captureOptions(options),main=this.context.mainWindow();return value.hideMainWindow&&main&&!main.isDestroyed()?[main]:[];}
  state(){this.check();return {screens:this.service.screens(),displayId:this.preferredDisplay(),active:this.service.active};}
  displays(){return this.run(async()=>{const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:320,height:200}});this.check();return sources.map(source=>({id:Number(source.display_id),thumbnail:source.thumbnail.toDataURL()}));});}
  take(mode:CaptureMode,displayId?:number,options?:CaptureOptions){return this.run(()=>this.service.take(mode,this.display(displayId),this.windows(options)));}
  custom(value:CustomCapture,displayId?:number,options?:CaptureOptions){return this.run(()=>this.service.take('region',this.display(displayId),this.windows(options),customCaptureFrom(value)));}
  windowsList(){return this.run(()=>this.service.captureWindows());}
  window(token:string,options?:CaptureOptions){return this.run(()=>this.service.takeWindow(token,this.windows(options)));}
  windowSet(tokens:string[],options?:CaptureOptions,placements?:unknown){return this.run(()=>this.service.takeWindowSet(tokens,this.windows(options),placements));}
  get pendingTasks(){return this.tasks.size;}
  stop(){if(this.stopping)return this.stopping;this.closing=true;return this.stopping=(async()=>{await this.service.stop();await Promise.allSettled([...this.tasks]);})();}
}
