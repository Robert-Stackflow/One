import {session,type BrowserWindow} from 'electron';
import {isAbsolute,relative,resolve,sep,join} from 'node:path';
import {OCRService,type RecognitionContext} from './service';
import {captureTranslation} from './capture-translation';
import {translationLanguage} from '../../shared/recognition/translation';
import type {SensitiveAPI} from '../../shared/recognition/sensitive-api';
import type {MaterialsService} from '../materials/service';
import {LlamaRuntimeStore} from './llama-runtime-store';
import {FormulaRuntimeStore} from './formula-runtime-store';
import {FormulaModels} from './formula-models';

/** One owns the profile, window, requests and cancellation across feature entry points. */
export class RecognitionHost {
  readonly service:OCRService;
  readonly formula:OCRService;
  readonly sensitive:SensitiveAPI;
  private tasks=new Set<Promise<unknown>>();
  private closing=false;
  private stopping?:Promise<void>;
  private runtimes:LlamaRuntimeStore;
  private formulaRuntime:FormulaRuntimeStore;
  private formulaModels:FormulaModels;
  constructor(directory:string,private materials:MaterialsService,private context:Omit<RecognitionContext,'protect'|'background'> & {createFormulaWindow():BrowserWindow}){
    const protect=(file:string)=>{materials.library.protect(file);const local=relative(resolve(directory),resolve(file));if(!local||!isAbsolute(local)&&local!=='..'&&!local.startsWith('..'+sep))throw Error('请保存到 One 数据目录之外');};
    this.runtimes=new LlamaRuntimeStore(join(directory,'models','runtimes','llama'),(input,options)=>session.fromPartition('one-model-download',{cache:false}).fetch(String(input),options));
    const transport:typeof fetch=(input,options)=>session.fromPartition('one-model-download',{cache:false}).fetch(String(input),options);
    this.formulaRuntime=new FormulaRuntimeStore(join(directory,'models','runtimes','formula'),transport);this.formulaModels=new FormulaModels(join(directory,'models','formula'),this.formulaRuntime,transport);
    this.formula=new OCRService(join(directory,'recognition'),{...context,protect,createWindow:()=>context.createFormulaWindow(),blocked:()=>this.closing||context.blocked(),background:task=>this.track(task)},'formula',this.runtimes,this.formulaModels);
    this.service=new OCRService(join(directory,'recognition'),{...context,protect,openFormula:(png,title)=>this.run(()=>this.formula.openCapture(png,title)),blocked:()=>this.closing||context.blocked(),background:task=>this.track(task)},'ocr',this.runtimes,this.formulaModels);
    this.sensitive={scanSensitive:(owner,png)=>this.run(()=>this.service.sensitive.run(owner,png)),cancelSensitive:owner=>this.service.sensitive.cancel(owner)};
  }
  private track<T>(task:Promise<T>){this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;}
  private run<T>(work:()=>Promise<T>){if(this.closing||this.context.blocked())return Promise.reject<T>(Error('识别服务已关闭'));return this.track(work());}
  openMaterial(id:string){return this.run(async()=>{
    await this.materials.initialized();if(this.closing||this.context.blocked())throw Error('识别服务已关闭');
    const item=await this.materials.library.images.detail(id);if(!item.payload.png)throw Error('图片素材不可用');
    const png=Buffer.from(item.payload.png,'base64');try{await this.service.open(png,item.title);}finally{png.fill(0);}
  });}
  openCapture(png:Buffer){return this.run(()=>this.service.openCapture(png));}
  openFormulaMaterial(id:string){return this.run(async()=>{
    await this.materials.initialized();if(this.closing||this.context.blocked())throw Error('识别服务已关闭');
    const item=await this.materials.library.images.detail(id);if(!item.payload.png)throw Error('图片素材不可用');
    const png=Buffer.from(item.payload.png,'base64');try{await this.formula.openCapture(png,item.title);}finally{png.fill(0);}
  });}
  openImage(png:Buffer,title:string){return this.run(()=>this.service.open(png,title));}
  translate(parent:BrowserWindow,png:Buffer,owner:string,target:string){return this.run(()=>captureTranslation(parent,this.service,owner,png,translationLanguage(target)));}
  cancelWorkflow(owner:string){return this.service.endCaptureWorkflow(owner);}
  get pendingTasks(){return this.tasks.size;}
  authorize(url:string,owner:number){return this.service.authorize(url,owner)||this.formula.authorize(url,owner);}
  resource(request:Request){return new URL(request.url).host==='formula-recognition'?this.formula.resource(request):this.service.resource(request);}
  stop(){if(this.stopping)return this.stopping;this.closing=true;return this.stopping=(async()=>{await Promise.all([this.service.stop(),this.formula.stop()]);await this.formulaModels.stop();await this.formulaRuntime.stop();await this.runtimes.stop();await Promise.allSettled([...this.tasks]);})();}
}
