import {serviceCredentialCrypto,type ServiceConnectionStorage} from '../service-connections';
import {clipboard,session,shell,type BrowserWindow,type IpcMainInvokeEvent} from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pngDimensions,decodePng,writeClipboardPng } from '../capture/clipboard';
import {saveImage} from '../capture/image-export';
import {imageTranslationDocument,imageTranslationSnapshot,type ImageTranslationDocument} from '../../shared/recognition/image-translation';
import {ImageHistory,type ImageDocument,type ImageHistoryState} from '../../shared/capture/image-document';
import { OCRModels } from './ocr-models';
import { OCRRunner } from './ocr-runner';
import { SensitiveScanner } from './sensitive-scanner';
import { OCRWorkflow } from './ocr-workflow';
import { ocrDimensions, ocrLanguage, ocrText, type OCRResult } from '../../shared/recognition/ocr';
import { RecognitionConnectionStore } from './connections';
import type {OneAIService} from '../ai-service';
import {RecognitionTaskProvider} from './task-provider';
import { TranslationClient } from './translation-client';
import type { TranslationResult } from '../../shared/recognition/translation';
import { FormulaClient } from './formula-client';
import {FormulaLocalRunner} from './formula-local-runner';
import {FormulaModelStore} from './formula-model-store';
import {FormulaRuntimeStore} from './formula-runtime-store';
import {FormulaImageRunner} from './formula-image-runner';
import {saveFormulaImage} from './formula-image-export';
import {formulaCrop} from '../../shared/recognition/formula-image';
import { formulaText, type FormulaResult } from '../../shared/recognition/formula';
import { LocalModelManager } from '../local-model-manager';
import { PaddleRunner } from './paddle-runner';
import { LlamaRunner } from './llama-runner';
import { LlamaRuntimeStore } from './llama-runtime-store';
import { deepseekOCRPresets } from './deepseek-models';
import { localModelCatalog } from '../local-model-catalog';
import { nativeRuntimeLicenses } from '../../shared/recognition/model-sources';
import { inferOCRImage, InlineOCREngine } from './image-inference';
import { InlineOCRSessions } from './inline-ocr';
import { readInferenceDevices,resolveInferenceDevice } from '../inference-devices';
import { selectedOCRRegion,replaceOCRSelection } from '../../shared/recognition/text-region';
import { correctOCRWord } from '../../shared/recognition/text-correction';
import { prepareOCRRectangle,replaceOCRRectangle } from '../../shared/recognition/text-area';
import { OCRImagePreview } from './image-preview';
export const RECOGNITION_URL = 'one://app/index.html?view=recognition';
export interface RecognitionContext {
  openTranslatedImage?(png:Buffer,title:string,document:ImageDocument,history:ImageHistoryState):Promise<void>;
  openFormula?(png:Buffer,title:string):Promise<void>;
  blocked():boolean;
  background<T>(task:Promise<T>):Promise<T>;
  uiScale():100|110|125|150;
  createWindow():BrowserWindow;
  register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  connections:ServiceConnectionStorage;
  ai?:OneAIService;
  manageServices?():Promise<void>;
  protect(path:string):void;
}
export class OCRService {
  readonly workflow: OCRWorkflow;
  readonly inline: InlineOCRSessions;
  readonly sensitive: SensitiveScanner;
  window?: BrowserWindow;
  private png?: Buffer;
  private token = '';
  private name = '';
  private size = { width: 0, height: 0 };
  private result?: OCRResult;
  private documentRevision=0;
  private progress = 0;
  private imagePreview?:OCRImagePreview;
  private running = false;
  private translating = false;
  private formulaRecognizing = false;
  private formulaSerial = 0;
  private formulaTask?: Promise<FormulaResult>;
  private formulaConfiguring = false;
  private translationSerial = 0;
  private translationTask?: Promise<TranslationResult>;
  private translationSnapshotToken='';
  private translatedImage?:ImageTranslationDocument;
  private configuring = false;
  private error = '';
  private opening = false;
  private rendererReady?: () => void;
  private settling: Promise<unknown> = Promise.resolve();
  readonly models: OCRModels;
  private runner: OCRRunner;
  readonly localModels: LocalModelManager;
  private paddle = new PaddleRunner();
  private native:LlamaRunner;
  private runtimes:LlamaRuntimeStore;
  private ownsRuntimes:boolean;
  private recognitionAbort?: AbortController;
  private recognitionTask?: Promise<OCRResult>;
  readonly translationStore: RecognitionConnectionStore;
  readonly translationClient: TranslationClient;
  readonly formulaStore: RecognitionConnectionStore;
  readonly formulaClient: FormulaClient;
  readonly formulaModels:FormulaModelStore;
  private formulaNative=new FormulaLocalRunner();
  private formulaRuntime?:FormulaRuntimeStore;
  private ownsFormulaModels:boolean;
  private formulaAbort?:AbortController;
  private formulaImages=new FormulaImageRunner();
  private formulaImageTask?:Promise<unknown>;
  private formulaProcessing=false;
  private formulaOriginal?:{png:Buffer;size:{width:number;height:number}};
  private serviceCheck?:AbortController;
  constructor(
    directory: string,
    private ctx: RecognitionContext,
    private kind: 'ocr' | 'formula' = 'ocr',
    runtimes?:LlamaRuntimeStore,
    formulaModels?:FormulaModelStore,
  ) {
    this.models = new OCRModels(join(directory, 'models'));
    this.runner = new OCRRunner(this.models);
    const transport:typeof fetch=(input,options)=>session.fromPartition('one-model-download',{cache:false}).fetch(String(input),options);
    this.ownsFormulaModels=!formulaModels;
    if(!formulaModels)this.formulaRuntime=new FormulaRuntimeStore(join(directory,'..','models','runtimes','formula'),transport);
    this.formulaModels=formulaModels||new FormulaModelStore(join(directory,'..','models','formula'),this.formulaRuntime!,{transport});
    this.ownsRuntimes=!runtimes;this.runtimes=runtimes||new LlamaRuntimeStore(join(directory,'..','models','runtimes','llama'),transport);
    const helper=process.env.ONE_TEST_MODE==='1'?process.env.ONE_INFERENCE_MONITOR:undefined;
    this.localModels = new LocalModelManager(join(directory, '..'), this.models,transport,
      signal => readInferenceDevices(signal,helper),{runtimes:this.runtimes,formulas:this.formulaModels,unloadNative:async id=>{await Promise.all([this.native.unload(id),this.inline?.unload(id),this.formulaNative.unload(id)]);}});
    this.native=new LlamaRunner(this.localModels.store,this.runtimes,join(directory,'native-sessions'),{helper});
    this.sensitive = new SensitiveScanner(this.models);
    this.workflow = new OCRWorkflow({
      prepare: async (png) => {
        if (this.window && this.png?.equals(png)) {
          if (this.running || this.translating || this.formulaRecognizing)
            throw Error('请先结束当前识别或翻译');
          this.window.show();
          this.window.focus();
        } else await this.open(png, '截图翻译');
        return this.token;
      },
      valid: (token) =>
        !!token &&
        token === this.token &&
        !!this.window &&
        !this.window.isDestroyed() &&
        !ctx.blocked(),
      config: () => this.translationStore.state(),
      recognize: (token) =>
        this.result?.language === 'chi_sim+eng'
          ? Promise.resolve(this.result)
          : this.recognize(token, 'chi_sim+eng'),
      translate: (token, text, target, revision) => this.translate(token, text, target, revision),
      cancel: async () => {
        await Promise.all([this.cancelRecognition(), this.cancelTranslation()]);
      },
    });
    const tasks=ctx.ai?new RecognitionTaskProvider(ctx.ai,()=>this.window?.webContents.id||0):undefined;
    this.translationStore = new RecognitionConnectionStore(ctx.connections,serviceCredentialCrypto,'translation',ctx.ai);
    this.translationClient = new TranslationClient(undefined,undefined,tasks);
    this.formulaStore = new RecognitionConnectionStore(ctx.connections,serviceCredentialCrypto,'formula',ctx.ai);
    this.formulaClient = new FormulaClient(undefined,undefined,tasks);
    this.inline = new InlineOCRSessions(()=>new InlineOCREngine(this.localModels,this.models,this.runtimes,directory),async()=>this.translationStore.connection((await this.translationStore.state()).revision),owner=>new TranslationClient(undefined,undefined,ctx.ai?new RecognitionTaskProvider(ctx.ai,()=>owner):undefined));
    const handle=(name:string,fn:(...args:any[])=>unknown)=>{
      if(this.kind==='formula' ? !['state','ready','image-preview'].includes(name)&&!name.startsWith('formula-')&&!name.startsWith('local-model') : name.startsWith('formula-'))return;
      ctx.register(this.scope+'-'+name,(event,...args)=>{
      if(ctx.blocked()||!this.window||event.sender!==this.window.webContents||event.senderFrame!==event.sender.mainFrame||event.sender.mainFrame.frames.length||event.senderFrame.url!==this.url)throw Error('拒绝访问识别窗口');
      return ctx.background(Promise.resolve().then(()=>fn(...args)));
    }); };
    handle('ready', () => { this.rendererReady?.(); });
    handle('image-preview',(token,region)=>{if(token!==this.token||!this.imagePreview)throw Error('识别图片已失效');return this.imagePreview.request(region);});
    handle('state', async () => { const selected = await this.localModels.selectedState(this.kind); return ({
      token: this.token,
      name: this.name,
      image: 'one-file://' + this.scope + '/' + this.token,
      uiScale:ctx.uiScale(),
      ...this.size,
      running: this.running,
      waitingForInference: this.runner.waiting || this.paddle.waiting || this.native.waiting||this.formulaNative.waiting||this.formulaImages.waiting,
      translating: this.translating,
      formulaRecognizing: this.formulaRecognizing,
      formulaProcessing:this.formulaProcessing,formulaHasOriginal:!!this.formulaOriginal,
      imageBytes: this.png?.length || 0,
      progress: this.progress,
      error: this.error,
      models: selected,
      modelTitle: selected.title,
      formulaLocal:this.kind==='formula'?{choice:await this.localModels.selection('formula'),revision:await this.localModels.settingsRevision()}:undefined,
      workflow: this.workflow.state,
    }); });
    handle('open-formula', async token => {
      if (this.kind !== 'ocr' || token !== this.token || !this.png || !ctx.openFormula) throw Error('公式图片已失效');
      const snapshot = Buffer.from(this.png); try { await ctx.openFormula(snapshot, this.name); } finally { snapshot.fill(0); }
    });
    handle('run', (token, value, mode = 'text') => {
      if (this.workflow.active) throw Error('正在执行识别流程，请先取消当前任务');
      return this.recognize(token, value, mode);
    });
    handle('region',(token,value,selection)=>{
      if(this.workflow.active)throw Error('正在执行识别流程，请先取消当前任务');
      return this.recognize(token,value,'text',selection);
    });
    handle('correct',(token,selection,text)=>{
      if(token!==this.token||!this.png||!this.result||this.ctx.blocked())throw Error('识别图片已失效');
      if(this.running||this.translating||this.workflow.active)throw Error('请先结束当前识别或翻译');
      const result=correctOCRWord(this.result,selection,text);
      this.result=result;this.documentRevision=result.document!.revision||this.documentRevision;
      return result;
    });
    handle('workflow-result', (token, id) => this.workflow.read(token, id));
    handle('workflow-back', (token, id) => {
      if (
        !token ||
        token !== this.token ||
        id !== this.workflow.state?.id ||
        this.workflow.active ||
        !this.workflow.state?.returnToCapture
      )
        throw Error('截图流程已失效');
      this.workflow.state.returnToCapture = false;
      this.window!.hide();
    });
    handle('cancel', () => (this.workflow.active ? this.workflow.cancel() : this.cancelRecognition()));
    handle('install', async () => {
      if (this.running || this.workflow.active) throw Error('请先取消识别，再下载语言包');
      const generation = this.token;
      await this.localModels.install((await this.localModels.selection('ocr')).modelId);
      if (generation === this.token) this.error = '';
    });
    handle('cancel-install', async () => this.localModels.cancel((await this.localModels.selection('ocr')).modelId));
    const modelAllowed=(id:unknown)=>{if(id==='tesseract'&&this.kind==='ocr')return;if(localModelCatalog.find(model=>model.id===id)?.purpose!==this.kind)throw Error('模型与当前窗口不匹配');};
    handle('local-models', refresh => { if (refresh !== undefined && typeof refresh !== 'boolean') throw Error('模型刷新参数无效'); return this.localModels.state(refresh,this.kind); });
    handle('local-model-save', (purpose, choice, revision) => {if(purpose!==this.kind)throw Error('模型与当前窗口不匹配');if(this.running||this.formulaRecognizing||this.formulaProcessing)throw Error('请先结束当前识别');return this.localModels.save(purpose, choice, revision);});
    handle('local-model-install', (id,preference) => {modelAllowed(id);return this.localModels.install(id,preference);});
    handle('local-model-cancel', id => {modelAllowed(id);return this.localModels.cancel(id);});
    handle('local-model-delete', id => {modelAllowed(id);return this.localModels.remove(id);});
    handle('local-model-devices', () => this.localModels.refreshDevices());
    handle('copy', async (value) => {
      const text = ocrText(value);
      if (!text.trim()) throw Error('没有可复制的文字');
      await clipboard.writeText(text);
    });
    handle('translation-config', () => this.translationStore.state());
    const servicePrefix=this.kind==='formula'?'formula':'translation',serviceStore=this.kind==='formula'?this.formulaStore:this.translationStore;
    handle(servicePrefix+'-profiles',()=>ctx.ai?.taskProfiles()||[]);
    handle(servicePrefix+'-services',()=>this.kind==='ocr'?ctx.ai?.translators.list()||[]:ctx.ai?.formulators.list()||[]);
    handle(servicePrefix+'-manage',()=>ctx.manageServices?.());
    handle(servicePrefix+'-check-cancel',()=>{this.serviceCheck?.abort();});
    handle(servicePrefix+'-verify',async reference=>{
      if(this.kind!=='formula'||!ctx.ai)throw Error('图片验证不可用');
      this.serviceCheck?.abort();const abort=new AbortController();this.serviceCheck=abort;
      try{await ctx.ai.verifyTaskImageInput(reference,this.window!.webContents.id,abort.signal);}finally{if(this.serviceCheck===abort)this.serviceCheck=undefined;}
    });
    handle(servicePrefix+'-migrate',revision=>serviceStore.migrateLegacy(revision));
    handle(servicePrefix+'-restore',revision=>this.kind==='ocr'?this.configureTranslation(()=>serviceStore.restoreLegacy(revision)):configureFormula(()=>serviceStore.restoreLegacy(revision)));
    handle('translation-save', (value) => {
      return this.configureTranslation(() => this.translationStore.save(value));
    });
    handle('translation-clear', (revision) => {
      return this.configureTranslation(() => this.translationStore.clear(revision));
    });
    handle('translate', (token, text, target, revision, selection=false) => {
      if (this.workflow.active) throw Error('正在执行识别流程，请先取消当前任务');
      return this.translate(token, text, target, revision,undefined,selection);
    });
    handle('translation-retry',(token,id,parts,revision,selection=false)=>{
      if(this.workflow.active||token!==this.translationSnapshotToken)throw Error('翻译结果已失效');
      return this.translate(token,undefined,undefined,revision,{id,parts},selection);
    });
    handle('translation-partial',async(token,revision,selection=false)=>{
      if(token!==this.token||token!==this.translationSnapshotToken)throw Error('翻译结果已失效');
      if((await this.translationStore.state()).revision!==revision)throw Error('翻译服务已改变');
      const result=this.translationClient.snapshot(selection);return result?.revision===revision?result:undefined;
    });
    handle('image-translation',async(token,id,revision)=>{
      if(this.kind==='formula'||token!==this.token||token!==this.translationSnapshotToken||this.running||this.translating||this.ctx.blocked())throw Error('图片翻译已失效');
      if((await this.translationStore.state()).revision!==revision)throw Error('翻译服务已改变');
      const result=this.translationClient.snapshot(false),document=this.result?.document;
      if(token!==this.token||this.running||this.translating||!document||!result||result.id!==id||result.revision!==revision)throw Error('图片文字或译文已改变');
      this.translatedImage=imageTranslationDocument(document,result,randomUUID());return this.translatedImage;
    });
    handle('image-translation-output',async(token,id,mode,png)=>{
      const document=this.translatedImage;
      const valid=()=>!!document&&document.id===id&&token===this.token&&document===this.translatedImage&&document.sourceId===this.result?.document?.id&&document.recognitionRevision===(this.result?.document?.revision||0)&&document.translationId===this.translationClient.snapshot(false)?.id&&!this.running&&!this.translating&&!this.ctx.blocked()&&!!this.window&&!this.window.isDestroyed();
      if(!valid()||!['copy','export'].includes(mode))throw Error('图片翻译已失效');
      if((await this.translationStore.state()).revision!==document!.serviceRevision||!valid())throw Error('翻译服务或图片已改变');
      const header=pngDimensions(png);if(header.width!==document!.width||header.height!==document!.height)throw Error('译图尺寸与原图不一致');
      const decoded=decodePng(png);
      try{
        if(!valid())throw Error('图片翻译已失效');
        if(mode==='copy'){await writeClipboardPng(decoded.data);return '已复制译图';}
        return await saveImage(this.window!,{payload:{png}},path=>this.ctx.protect(path),valid,{title:'保存译图',defaultPath:'One-translated.png'});
      }finally{decoded.data.fill(0);}
    });
    handle('image-translation-editor',async(token,id,value,past)=>{
      const base=this.translatedImage;
      const valid=()=>!!base&&base.id===id&&token===this.token&&base===this.translatedImage&&base.sourceId===this.result?.document?.id&&base.recognitionRevision===(this.result?.document?.revision||0)&&base.translationId===this.translationClient.snapshot(false)?.id&&!this.running&&!this.translating&&!this.ctx.blocked();
      if(!valid()||!this.png||!this.ctx.openTranslatedImage)throw Error('图片翻译已失效或编辑器不可用');
      if((await this.translationStore.state()).revision!==base!.serviceRevision||!valid())throw Error('翻译服务或图片已改变');
      if(!Array.isArray(past)||past.length>20)throw Error('翻译修改历史无效');
      const initial=new ImageHistory(this.size.width,this.size.height,true).value;
      const scene=(document:unknown):ImageDocument=>({...initial,translation:{visible:true,document:imageTranslationSnapshot(base!,document)}});
      const current=scene(value),history:ImageHistoryState={past:[],future:[]};
      for(const previous of past){if(!valid())throw Error('图片翻译已失效');history.past.push(scene(previous));await new Promise<void>(resolve=>setImmediate(resolve));}
      if(!valid()||(await this.translationStore.state()).revision!==base!.serviceRevision)throw Error('图片翻译已失效');const png=Buffer.from(this.png);
      try{await this.ctx.openTranslatedImage(png,('译图 · '+this.name).slice(0,180),current,history);}finally{png.fill(0);}
    });
    handle('translation-cancel', () =>
      this.workflow.active ? this.workflow.cancel() : this.cancelTranslation(),
    );
    handle('formula-config', () => this.formulaStore.state());
    const configureFormula = async <T>(operation: () => Promise<T>) => {
      if (this.formulaRecognizing || this.formulaProcessing||this.formulaConfiguring || this.workflow.active)
        throw Error('请先结束公式识别或配置操作');
      this.formulaConfiguring = true;
      try {
        return await operation();
      } finally {
        this.formulaConfiguring = false;
      }
    };
    handle('formula-save', (value) => configureFormula(() => this.formulaStore.save(value)));
    handle('formula-clear', (revision) =>
      configureFormula(() => this.formulaStore.clear(revision)),
    );
    handle('formula-recognize', (token, revision,rotation=0) => {
      if (this.workflow.active) throw Error('请先取消识别流程');
      if (token !== this.token || !this.png) throw Error('识别图片已失效');
      if (this.running || this.translating || this.formulaRecognizing||this.formulaProcessing)
        throw Error('请先结束当前识别或翻译');
      if(![0,1,2,3].includes(rotation))throw Error('图片旋转参数无效');
      if (this.formulaConfiguring) throw Error('公式配置正在保存，请稍后重试');
      const generation = this.token,
        serial = ++this.formulaSerial;
      this.formulaRecognizing = true;
      this.progress=0;
      const abort=this.formulaAbort=new AbortController();
      const task = (async () => {
        let oriented:Buffer|undefined;
        try {
          const source=rotation?(oriented=(await this.formulaImages.crop(this.png!,this.size,{region:{left:0,top:0,...this.size},rotation})).png):this.png!;
          abort.signal.throwIfAborted();
          const selected=await this.localModels.selection('formula');abort.signal.throwIfAborted();
          if(selected.modelId!=='service'){
            if(revision!==await this.localModels.settingsRevision())throw Error('公式模型设置已改变，请重新识别');
            const device=selected.device.mode==='gpu'?resolveInferenceDevice(selected.device,await readInferenceDevices(abort.signal,process.env.ONE_TEST_MODE==='1'?process.env.ONE_INFERENCE_MONITOR:undefined),384*384):{backend:'cpu' as const};
            const release=this.localModels.use(selected.modelId);let lease:Awaited<ReturnType<FormulaModelStore['acquire']>>|undefined;
            try{
              lease=await this.formulaModels.acquire(abort.signal);abort.signal.throwIfAborted();
              if(lease.model.id!==selected.modelId)throw Error('公式模型与准备缓存不匹配');
              if(generation!==this.token||serial!==this.formulaSerial||ctx.blocked())throw Error('公式识别已取消');
              const result=await this.formulaNative.run(source,lease.model,{device:selected.device.mode,deviceId:'gpu' in device?device.gpu!.deviceId:0,automaticBackend:device.backend},progress=>{if(generation===this.token&&serial===this.formulaSerial)this.progress=progress;});
              if(abort.signal.aborted||generation!==this.token||serial!==this.formulaSerial||ctx.blocked())throw Error('公式识别已取消');
              if(JSON.stringify(await this.localModels.selection('formula'))!==JSON.stringify(selected))throw Error('公式模型设置已改变，请重新识别');
              return {text:result.text,model:selected.modelId,endpoint:'local:'+selected.modelId,revision,inference:{backend:result.actualBackend,device:result.actualBackend==='cpu'?'CPU':'DirectML · '+result.deviceId,fallbackReason:result.fallbackReason}} as FormulaResult;
            }finally{lease?.release();release();}
          }
          const connection = await this.formulaStore.connection(revision);
          if (generation !== this.token || serial !== this.formulaSerial || ctx.blocked())
            throw Error('公式识别已取消');
          const result = await this.formulaClient.run(connection, source);
          if((await this.formulaStore.state()).revision!==connection.revision)throw Error('公式服务已改变，请重新识别');
          if (generation !== this.token || serial !== this.formulaSerial || ctx.blocked())
            throw Error('公式识别已取消');
          return result;
        } finally {
          oriented?.fill(0);
          if (generation === this.token) this.formulaRecognizing = false;
        }
      })();
      this.formulaTask = task;
      return task.finally(() => {
        if (this.formulaTask === task){this.formulaTask = undefined;this.formulaAbort=undefined;}
      });
    });
    handle('formula-cancel', () => this.cancelFormula());
    handle('formula-copy', async (value) => {
      const text = formulaText(value);
      if (!text.trim()) throw Error('没有可复制的公式');
      await clipboard.writeText(text);
    });
    handle('formula-crop',(token,value)=>this.formulaImageOperation(token,async valid=>{
      const next=value===undefined?this.formulaOriginal:await this.formulaImages.crop(this.png!,this.size,formulaCrop(value,this.size));
      if(!next)return;
      const png=next.png,size='size' in next?next.size:{width:next.width,height:next.height};
      if(!valid())throw Error('公式裁剪已取消');await this.imagePreview?.close();if(!valid())throw Error('公式裁剪已取消');
      const previous=this.png!;
      if(value===undefined)this.formulaOriginal=undefined;else this.formulaOriginal||={png:previous,size:{...this.size}};
      this.png=png;this.size=size;this.token=randomUUID();this.imagePreview=new OCRImagePreview(png,size);
      if(previous!==this.formulaOriginal?.png&&previous!==png)previous.fill(0);
    }));
    handle('formula-output',(token,value,mode)=>this.formulaImageOperation(token,async valid=>{
      if(!['copy','png','svg'].includes(mode))throw Error('公式导出格式无效');const text=formulaText(value);if(!text.trim())throw Error('没有可导出的公式');
      const result=await this.formulaImages.render(text);if(!valid())throw Error('公式导出已取消');
      if(mode==='copy'){await writeClipboardPng(result.png);return '已复制公式图片';}
      return saveFormulaImage(this.window!,mode,mode==='svg'?Buffer.from(result.svg!):result.png,this.ctx.protect,valid);
    }));
  }
  private get scope() { return this.kind === 'formula' ? 'formula-recognition' : 'recognition'; }
  private get url() { return 'one://app/index.html?view=' + this.scope; }
  authorize(url:string,owner:number){
    // Chromium can attribute an inherited about:blank request to its parent frame.
    // This dedicated window has no child documents, so reject its resources if any appear.
    return !!this.token&&!!this.png&&!this.ctx.blocked()&&!!this.window&&!this.window.isDestroyed()&&this.window.webContents.id===owner&&this.window.webContents.mainFrame.frames.length===0&&this.window.webContents.getURL()===this.url&&url==='one-file://'+this.scope+'/'+this.token;
  }
  resource(request:Request){
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    if(!this.window||!this.authorize(request.url,this.window.webContents.id))return new Response(null,{status:404});
    return new Response(request.method==='HEAD'?null:new Uint8Array(this.png!),{headers:{'Content-Type':'image/png','Content-Length':String(this.png!.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'one://app'}});
  }
  private async recognize(token: unknown, value: unknown, mode: unknown = 'text',selection?:unknown) {
    if (token !== this.token || !this.png) throw Error('识别图片已失效');
    if (this.running) throw Error('正在识别，请先取消当前任务');
    if (this.translating) throw Error('请先取消翻译，再识别文字');
    if (this.formulaRecognizing) throw Error('请先取消公式识别');
    if (mode === 'table') throw Error('表格识别已移除，请使用普通文字识别');
    if (mode !== 'text') throw Error('识别模式无效');
    const language = ocrLanguage(value),
      generation = this.token;
    const base=selection===undefined?undefined:this.result;
    const rectangle=selection&&typeof selection==='object'&&Object.hasOwn(selection,'region')?prepareOCRRectangle(base,this.size,selection):undefined;
    if(selection!==undefined&&!base&&!rectangle)throw Error('请先识别全文');
    const region=rectangle|| (base?selectedOCRRegion(base,selection):undefined);
    this.running = true;
    this.progress = 0;
    this.error = '';
    const abort = this.recognitionAbort = new AbortController();
    const task = (async () => {
      const result=await inferOCRImage({models:this.localModels,runner:this.runner,paddle:this.paddle,native:this.native},this.png!,this.size,language,abort.signal,
        value=>{if(this.token===generation)this.progress=Math.max(this.progress,value);},region?.context);
      abort.signal.throwIfAborted();return rectangle?replaceOCRRectangle(base,result,rectangle.selection):base&&region?replaceOCRSelection(base,result,region.selection as import('../../shared/recognition/text-region').OCRRegionSelection):result;
    })();
    this.recognitionTask = task;
    try {
      const result = await task;
      if (abort.signal.aborted || generation !== this.token || this.ctx.blocked()) throw Error('文字识别已取消');
      if(result.document){this.documentRevision=Math.max(this.documentRevision+1,result.document.revision||0);result.document.revision=this.documentRevision;result.document.id=result.document.id.replace(/:r\d+$/,'')+`:r${this.documentRevision}`;}
      this.result = result;
      this.progress = 1;
      return result;
    } catch (error) {
      const failure = abort.signal.aborted ? Error('文字识别已取消') : error;
      if (generation === this.token)
        this.error = failure instanceof Error ? failure.message : '文字识别失败';
      throw failure;
    } finally {
      if (this.recognitionTask === task) { this.recognitionTask = undefined; this.recognitionAbort = undefined; }
      if (generation === this.token) this.running = false;
    }
  }
  private async cancelRecognition() {
    this.recognitionAbort?.abort();
    await Promise.all([this.runner.cancel(), this.paddle.cancel(),this.native.cancel()]);
    await this.recognitionTask?.catch(() => {});
  }
  private async translate(token: unknown, text: unknown, target: unknown, revision: unknown,retry?:{id:unknown;parts:unknown},selection=false) {
    if (token !== this.token || !this.png) throw Error('识别图片已失效');
    if (this.translating || this.running || this.formulaRecognizing)
      throw Error('请先结束当前识别或翻译');
    if (this.configuring) throw Error('翻译配置正在保存，请稍后重试');
    const generation = this.token;
    const serial = ++this.translationSerial;
    this.translating = true;
    const task = (async () => {
      try {
        const connection = await this.translationStore.connection(revision);
        if (generation !== this.token || serial !== this.translationSerial || this.ctx.blocked())
          throw Error('翻译已取消');
        this.translationSnapshotToken=generation;
        const result = await (retry?this.translationClient.retry(connection,retry.id,retry.parts,selection):this.translationClient.run(connection, text, target,selection));
        if((await this.translationStore.state()).revision!==connection.revision)throw Error('翻译服务已改变，请重新翻译');
        if (generation !== this.token || serial !== this.translationSerial || this.ctx.blocked())
          throw Error('翻译已取消');
        if(!selection)this.workflow.acceptTranslation(result);
        return result;
      } finally {
        if (generation === this.token) this.translating = false;
      }
    })();
    this.translationTask = task;
    return task.finally(() => {
      if (this.translationTask === task) this.translationTask = undefined;
    });
  }
  private async configureTranslation<T>(operation: () => Promise<T>) {
    if (this.workflow.active) throw Error('请先结束识别流程，再配置翻译服务');
    if (this.translating || this.configuring || this.formulaRecognizing)
      throw Error('请先结束翻译或配置操作');
    this.configuring = true;
    try {
      return await operation();
    } finally {
      this.configuring = false;
    }
  }
  checkWorkflow(png: Buffer) {
    if (this.ctx.blocked()) throw Error('应用正在退出');
    if (
      this.opening ||
      this.workflow.active ||
      this.running ||
      this.translating ||
      this.formulaRecognizing
    )
      throw Error('请先结束当前识别或翻译');
    if (this.window && !this.png?.equals(png))
      throw Error('请先关闭当前文字识别窗口，再执行截图翻译');
  }
  async openCapture(png: Buffer, name = '截图') {
    if (this.ctx.blocked()) throw Error('应用正在退出');
    if (this.window && !this.window.isDestroyed() && this.png?.equals(png)) {
      this.window.show();
      this.window.focus();
      return;
    }
    await this.open(png, name);
  }
  async endCaptureWorkflow(owner: string) {
    await this.workflow.cancel(owner);
    if (
      this.workflow.owner === owner &&
      this.window &&
      !this.window.isDestroyed() &&
      !this.window.isVisible() &&
      !this.ctx.blocked()
    )
      this.window.showInactive();
  }
  private async cancelTranslation() {
    this.translationSerial++;
    await this.translationClient.cancel();
    await this.translationTask?.catch(() => {});
  }
  private async cancelFormula() {
    this.formulaSerial++;
    this.formulaAbort?.abort();
    const tasks=[this.formulaTask,this.formulaImageTask];
    await Promise.all([this.formulaClient.cancel(),this.formulaNative.cancel(),this.formulaImages.cancel()]);
    await Promise.allSettled(tasks);
  }
  private formulaImageOperation<T>(token:unknown,work:(valid:()=>boolean)=>Promise<T>){
    if(token!==this.token||!this.png)throw Error('公式图片已失效');
    if(this.formulaRecognizing||this.formulaProcessing||this.formulaConfiguring||this.workflow.active)throw Error('请先结束当前公式任务');
    this.formulaProcessing=true;const serial=++this.formulaSerial;
    const valid=()=>token===this.token&&serial===this.formulaSerial&&!this.ctx.blocked()&&!!this.window&&!this.window.isDestroyed();
    const task=Promise.resolve().then(()=>work(valid));this.formulaImageTask=task;
    return task.finally(()=>{if(this.formulaImageTask===task){this.formulaImageTask=undefined;this.formulaProcessing=false;}});
  }
  async open(png: Buffer, name: string) {
    if (this.ctx.blocked()) throw Error('应用正在退出');
    if (this.window || this.opening) {
      this.window?.show();
      this.window?.focus();
      throw Error(`请先关闭当前${this.kind === 'formula' ? '公式识别' : '文字识别'}窗口，再识别其他图片`);
    }
    this.opening = true;
    try {
      await this.settling;
      if (this.ctx.blocked()) throw Error('应用正在退出');
      const base64 = png.toString('base64'),
        header = pngDimensions(base64);
      if(this.kind==='formula')ocrDimensions(header.width, header.height);
      this.size = header;
      this.png = Buffer.from(png);
      this.imagePreview=new OCRImagePreview(this.png,this.size);
      this.token = randomUUID();
      this.name = name.slice(0, 180);
      this.result = undefined;this.translatedImage=undefined;
      this.error = '';
      this.progress = 0;
      this.running = false;
      this.translating = false;
      this.formulaRecognizing = false;
      const window = this.ctx.createWindow();
      this.window = window;
      const sources=new Set([...localModelCatalog.map(model=>model.weightLicense.source),
        ...deepseekOCRPresets.map(model=>model.artifacts[0].url.split('/resolve/')[0]),...nativeRuntimeLicenses.map(value=>value.url)]);
      window.webContents.setWindowOpenHandler(({url}) => {
        if(sources.has(url))void this.ctx.background(shell.openExternal(url)).catch(()=>{this.error='无法打开模型资源链接';});
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (e) => e.preventDefault());
      window.webContents.on('will-attach-webview', (e) => e.preventDefault());
      window.webContents.once('render-process-gone',()=>{if(!window.isDestroyed())window.destroy();});
      window.once('closed', () => {
        if (this.window === window) {
          this.window = undefined;
          this.clear();
        }
      });
      let readyTimer: ReturnType<typeof setTimeout> | undefined;
      let closedBeforeReady: () => void = () => {};
      const prepared = new Promise<void>((resolve,reject) => {
        this.rendererReady=resolve;
        readyTimer=setTimeout(()=>reject(Error('识别窗口初始化超时')),15000);
        closedBeforeReady=()=>reject(Error('识别窗口已关闭'));
        window.once('closed',closedBeforeReady);
      });
      // loadURL resolves before dynamically imported CSS and initial view layout.
      // Observe both promises immediately so a close/load failure cannot leak a rejection.
      try { await Promise.all([window.loadURL(this.url),prepared]); }
      finally { clearTimeout(readyTimer);this.rendererReady=undefined;window.removeListener('closed',closedBeforeReady); }
      if (this.window === window && !window.isDestroyed()) window.show();
    } catch (error) {
      const window = this.window;
      this.window = undefined;
      window?.destroy();
      this.clear(false);
      throw error;
    } finally {
      this.opening = false;
    }
  }
  private clear(cancelWorkflow = true) {
    this.workflow.closed(cancelWorkflow);
    this.token = '';
    this.translationSnapshotToken='';
    const preview=this.imagePreview;this.imagePreview=undefined;
    const closingPreview=preview?.close();
    this.png?.fill(0);
    this.formulaOriginal?.png.fill(0);this.formulaOriginal=undefined;
    this.png = undefined;
    this.result = undefined;this.translatedImage=undefined;
    this.models.cancel();
    this.settling = Promise.all([
      closingPreview,
      this.cancelRecognition(),
      this.localModels.settle(),
      this.models.settle(),
      this.cancelTranslation().finally(()=>this.translationClient.clearSnapshot()),
      this.translationStore.settle(),
      this.cancelFormula(),
      this.formulaStore.settle(),
    ]);
    void this.ctx.background(this.settling).catch(() => {});
  }
  async stop() {
    this.serviceCheck?.abort();
    await this.inline.stop();
    await this.sensitive.cancel();
    this.window?.destroy();
    this.window = undefined;
    this.clear();
    await this.settling;
    await Promise.all([this.paddle.close(), this.native.close(),this.formulaNative.close(),this.formulaImages.close(),this.localModels.stop()]);
    if(this.ownsFormulaModels){await this.formulaModels.stop();await this.formulaRuntime?.stop();}
    if(this.ownsRuntimes)await this.runtimes.stop();
  }
}
