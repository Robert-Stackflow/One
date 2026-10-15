import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { LocalModelChoice, LocalModelEntry, LocalModelManagerState, LocalModelProgress, LocalModelPurpose, LocalModelState } from '../shared/local-models';
import { inferencePreference } from '../shared/inference-devices';
import { LocalModelStore } from './local-model-store';
import { localModelCatalog } from './local-model-catalog';
import { readInferenceDevices } from './inference-devices';
import { OCRModels, ocrPacks } from './recognition/ocr-models';
import { aiModelPath, repairModel, validAiModel } from './image-ai-model';
import { resolveCUDAInferenceDevice } from './inference-devices';
import type { LlamaRuntimeStore } from './recognition/llama-runtime-store';
import { llamaRuntimeProfiles } from './recognition/llama-runtime-catalog';
import type {FormulaModels} from './recognition/formula-models';
import {formulaRuntimeProfile} from './recognition/formula-runtime-catalog';

export interface LocalModelManagerOptions {
  runtimes?: LlamaRuntimeStore;
  formulas?:FormulaModels;
  unloadNative?:(id?:string)=>Promise<void>;
}

const defaults = () => ({ ocr: { modelId: 'tesseract', device: { mode: 'auto' as const } }, repair: { modelId: 'migan-pipeline-v2', device: { mode: 'auto' as const } },formula:{modelId:'service',device:{mode:'auto' as const}} });
interface ModelSettings {choices:LocalModelManagerState['choices'];revision:string;loading?:Promise<void>;saving:boolean}
// OCR and formula windows share preferences, revisions and the save lock.
const modelSettings=new Map<string,ModelSettings>();
export class LocalModelManager {
  readonly store: LocalModelStore;
  private settings:ModelSettings;
  private get choices(){return this.settings.choices;}private set choices(value:LocalModelManagerState['choices']){this.settings.choices=value;}
  private get revision(){return this.settings.revision;}private set revision(value:string){this.settings.revision=value;}
  private get loading(){return this.settings.loading;}private set loading(value:Promise<void>|undefined){this.settings.loading=value;}
  private get saving(){return this.settings.saving;}private set saving(value:boolean){this.settings.saving=value;}
  private deviceTask?: Promise<void>;
  private devicesAbort?: AbortController;
  private devices: LocalModelManagerState['devices'] = { gpus: [] };
  private states = new Map<string, LocalModelState>();
  private tasks = new Map<string, { abort: AbortController; promise: Promise<unknown> }>();
  private progress = new Map<string, LocalModelProgress>();
  private errors = new Map<string, string>();
  private usage = new Map<string, number>();
  private legacyRepairReady = false;
  private stopped = false;
  constructor(private dataDirectory: string, private tesseract: OCRModels, transport: typeof fetch = fetch,
      private deviceReader: typeof readInferenceDevices = readInferenceDevices, private options:LocalModelManagerOptions={}) {
    this.dataDirectory = resolve(dataDirectory);
    const key=process.platform==='win32'?this.dataDirectory.toLowerCase():this.dataDirectory;
    if(!modelSettings.has(key))modelSettings.set(key,{choices:defaults(),revision:randomUUID(),saving:false});this.settings=modelSettings.get(key)!;
    this.store = new LocalModelStore(join(dataDirectory, 'models', 'library'), transport);
  }
  private preset(id: unknown) {
    const model = localModelCatalog.find(model => model.id === id);
    if (!model) throw Error('此模型尚未适配，无法下载或使用');
    return model;
  }
  private choice(purpose: unknown, input: unknown): LocalModelChoice {
    if (purpose !== 'ocr' && purpose !== 'repair'&&purpose!=='formula') throw Error('此功能尚未接入本地模型');
    const value = input as LocalModelChoice;
    if (!value || typeof value.modelId !== 'string') throw Error('模型选择无效');
    const backends = purpose === 'ocr' && value.modelId === 'tesseract'||purpose==='formula'&&value.modelId==='service' ? ['cpu'] : (() => {
      const model = this.preset(value.modelId); if (model.purpose !== purpose) throw Error('模型与功能不匹配'); return model.backends;
    })();
    const device = inferencePreference(value.device);
    if (device.mode === 'gpu' && !backends.includes('dml') && !backends.includes('cuda')) throw Error('此模型尚未适配 GPU，请使用 CPU 或自动模式');
    return { modelId: value.modelId, device };
  }
  private load() {
    return this.loading ||= (async () => {
      const path = join(this.dataDirectory, 'local-models.json');
      let stat;
      try { stat = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('本地模型设置文件无效');
      const value = JSON.parse(await readFile(path, 'utf8'));
      this.choices = { ocr: this.choice('ocr', value.ocr), repair: this.choice('repair', value.repair),formula:value.formula?this.choice('formula',value.formula):defaults().formula };
      if(value.formulaPrevious){const previous=this.choice('formula',value.formulaPrevious);if(previous.modelId==='service')throw Error('本地公式模型设置无效');this.choices.formulaPrevious=previous;}
    })();
  }
  async selection(purpose: LocalModelPurpose):Promise<LocalModelChoice> { await this.load(); return structuredClone(this.choices[purpose]||defaults().formula); }
  async settingsRevision(){await this.load();return this.revision;}
  async save(purpose: unknown, choice: unknown, revision: unknown) {
    await this.load();
    if (this.stopped) throw Error('本地模型服务已关闭');
    if (revision !== this.revision) throw Error('模型设置已更新，请刷新后重试');
    if (this.saving) throw Error('正在保存模型设置');
    const validated = this.choice(purpose, choice), next = { ...this.choices, [purpose as string]: validated };
    if(purpose==='formula'&&validated.modelId!=='service')next.formulaPrevious=validated;
    this.saving = true;
    const temporary = join(this.dataDirectory, '.local-models-' + randomUUID() + '.tmp');
    try {
      await mkdir(this.dataDirectory, { recursive: true });
      const file = await open(temporary, 'wx');
      try { await file.writeFile(JSON.stringify(next)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.dataDirectory, 'local-models.json'));
      this.choices = next; this.revision = randomUUID();
      return this.revision;
    } finally { this.saving = false; await unlink(temporary).catch(() => {}); }
  }
  async refreshDevices() {
    if (this.stopped) throw Error('本地模型服务已关闭');
    if (!this.deviceTask) {
      const abort = this.devicesAbort = new AbortController();
      const task = this.deviceReader(abort.signal).then(value => { this.devices = value; }).finally(() => { if (this.deviceTask === task) { this.deviceTask = undefined; this.devicesAbort = undefined; } });
      this.deviceTask = task;
    }
    await this.deviceTask;
    return structuredClone(this.devices);
  }
  private async modelState(id: string, refresh = false, runtimesReady?: Promise<{cpu:boolean;cuda:boolean}>) {
    const model = this.preset(id);
    if(model.purpose==='formula')return this.options.formulas?this.options.formulas.state(model.id):{ready:false,downloadedBytes:0,diskBytes:0,totalBytes:model.artifacts.reduce((sum,file)=>sum+file.bytes,0),downloading:false,inUse:false};
    // UI reads installed-file metadata only. Download publication and acquire()
    // verify SHA-256; opening/polling a dialog must never stream model weights.
    if (model.purpose === 'ocr') {
      const state=await this.store.state(model,undefined,false);
      if(model.backends.includes('cuda')){
        const cpuReady=runtimesReady?(await runtimesReady).cpu:!!(await this.options.runtimes?.state('cpu'))?.ready;
        state.ready=state.ready&&cpuReady;
      }
      return state;
    }
    if (!this.states.has(id) || refresh) {
      this.states.set(id, await this.store.state(model));
      if (model.purpose === 'repair') this.legacyRepairReady = await validAiModel(this.dataDirectory, repairModel);
    }
    const current = await this.store.state(model, undefined, false), verified = this.states.get(id)!;
    if (model.purpose === 'repair') {
      const legacy = await lstat(aiModelPath(this.dataDirectory, repairModel)).catch(() => undefined);
      if (!legacy?.isFile() || legacy.isSymbolicLink()) this.legacyRepairReady = false;
      return { ...current, ready: current.ready && verified.ready || this.legacyRepairReady,
        diskBytes: current.diskBytes + (legacy?.isFile() && !legacy.isSymbolicLink() ? legacy.size : 0) };
    }
    return { ...current, ready: current.ready && verified.ready };
  }
  async state(refresh = false, purpose?: LocalModelPurpose): Promise<LocalModelManagerState> {
    await this.load();
    const catalog=localModelCatalog.filter(model=>!purpose||model.purpose===purpose);
    // Independent metadata reads share one runtime snapshot, including both DeepSeek presets.
    const runtimeReady=catalog.some(model=>model.backends.includes('cuda'))?
      Promise.all([this.options.runtimes?.state('cpu'),this.options.runtimes?.state('cuda')])
        .then(([cpu,cuda])=>({cpu:!!cpu?.ready,cuda:!!cuda?.ready})):undefined;
    const models=Promise.all(catalog.map(async model=>({model,cached:await this.modelState(model.id,refresh,runtimeReady)})));
    const [legacy,snapshots,runtime]=await Promise.all([purpose==='formula'?{ready:false,downloading:false,diskBytes:0,progress:0,error:''}:this.tesseract.state(),models,runtimeReady]);
    const legacyBytes = ocrPacks.reduce((sum, file) => sum + file.bytes, 0);
    const entries: LocalModelEntry[] = purpose==='formula'?[]:[{ id: 'tesseract', title: 'Tesseract', size: 'fast', purpose: 'ocr', revision: 'tessdata_fast@8741641',
      languages: ['中文', 'English'], backends: ['cpu'], weightLicense: 'Apache-2.0', runtime: 'tesseract.js', precision: 'traineddata',
      ready: legacy.ready, downloading: legacy.downloading, inUse: !!this.usage.get('tesseract'), totalBytes: legacyBytes,
      diskBytes: legacy.diskBytes, downloadedBytes: legacy.ready ? legacyBytes : 0,
      progress: legacy.progress, error: legacy.error,selection:'glyph', note: '兼容引擎；支持真实字符框选择' }];
    for (const {model,cached} of snapshots) {
      const progress = this.progress.get(model.id), downloading = this.tasks.has(model.id)||cached.downloading;
      const native=model.backends.includes('cuda');
      entries.push({ ...cached, downloading, inUse: native ? !!this.usage.get(model.id) : cached.inUse || !!this.usage.get(model.id), id: model.id, title: model.title, size: model.size,
        purpose: model.purpose, revision: model.revision, languages: [...model.languages], backends: [...model.backends], weightLicense: model.weightLicense.name,
        runtime: model.runtime, precision: model.precision, measuredMemoryMiB: model.measuredMemoryMiB, measuredVRAMMiB: model.measuredVRAMMiB,
        weightLicenseSource:model.weightLicense.source,source:native?model.artifacts[0].url.split('/resolve/')[0]:undefined,
        runtimeReady:native?runtime:undefined,
        preparationBytes:model.purpose==='formula'?formulaRuntimeProfile.artifacts.reduce((sum,file)=>sum+file.bytes,0):undefined,
        selection:model.purpose==='ocr'?(native?'region':'ctc'):undefined,
        orientationModel:model.purpose==='ocr'&&!native?model.artifacts.some(file=>file.role==='orientation'):undefined,
        progress: progress ? progress.received / progress.total : 0,phase:progress?.phase, downloadedBytes: downloading && progress ? Math.min(cached.totalBytes,progress.received) : cached.downloadedBytes,
        error: this.errors.get(model.id) || '', note: model.purpose==='formula'?'印刷公式；自动模式使用 CPU':native?'CPU / NVIDIA CUDA；模型估计区域按整段选择，位置可能偏移':model.purpose === 'ocr' ? '已验证 CPU/DirectML；CTC 与高对比像素投影提供近似定位，缺失对齐时保留行框' : '已验证 CPU；保留旧缓存供旧版使用' });
    }
    return { revision: this.revision, choices: structuredClone(this.choices), entries, devices: structuredClone(this.devices) };
  }
  async selectedState(purpose:'ocr'|'formula'='ocr') {
    const selected = await this.selection(purpose);
    if(selected.modelId==='service')return {ready:false,downloading:false,progress:0,error:'',title:'视觉服务'};
    if (selected.modelId === 'tesseract') return { ...await this.tesseract.state(), title: 'Tesseract fast' };
    const model = this.preset(selected.modelId), state = await this.modelState(model.id), progress = this.progress.get(model.id);
    if(model.backends.includes('cuda')&&selected.device.mode==='gpu')state.ready=state.ready&&!!(await this.options.runtimes?.state('cuda'))?.ready;
    return { ready: state.ready, downloading: this.tasks.has(model.id)||state.downloading, progress: progress ? progress.received / progress.total : 0,
      error: this.errors.get(model.id) || '', title: model.title + ' ' + model.size };
  }
  install(id: unknown, preference?:unknown) {
    if (this.stopped) return Promise.reject(Error('本地模型服务已关闭'));
    if (id === 'tesseract') return this.tesseract.install();
    const model = this.preset(id);
    if (this.tasks.has(model.id)) return Promise.reject(Error('正在下载此模型'));
    const abort = new AbortController(); this.errors.delete(model.id);this.progress.delete(model.id);
    // The legacy MI-GAN file can migrate without another download.
    const sources: Record<string, string> = model.purpose === 'repair' ? { repair: aiModelPath(this.dataDirectory, repairModel) } : {};
    const task = (model.purpose==='formula'?(this.options.formulas?this.options.formulas.install(model.id,abort.signal,value=>this.progress.set(model.id,value)):Promise.reject(Error('公式模型服务未初始化'))):model.backends.includes('cuda')?this.installNative(model.id,preference,abort.signal):this.store.install(model, abort.signal, value => this.progress.set(model.id, value), sources)).catch(error => {
      if (!abort.signal.aborted) this.errors.set(model.id, error instanceof Error ? error.message : '模型下载失败'); throw error;
    }).finally(async () => { this.tasks.delete(model.id); this.states.delete(model.id); await this.modelState(model.id).catch(() => {}); });
    this.tasks.set(model.id, { abort, promise: task });
    return task;
  }
  private async installNative(id:string,input:unknown,signal:AbortSignal){
    const runtime=this.options.runtimes;if(!runtime)throw Error('原生模型运行包服务未初始化');
    await this.load();signal.throwIfAborted();const model=this.preset(id);
    const preference=inferencePreference(input??(this.choices.ocr.modelId===id?this.choices.ocr.device:{mode:'auto'}));
    const selected=resolveCUDAInferenceDevice(preference,preference.mode==='cpu'?{gpus:[]}:await this.deviceReader(signal));
    const backends:('cpu'|'cuda')[]=selected.backend==='cuda'?['cpu','cuda']:['cpu'];
    const weightBytes=model.artifacts.reduce((sum,file)=>sum+file.bytes,0);
    const bytes=(backend:'cpu'|'cuda')=>llamaRuntimeProfiles.find(value=>value.backend===backend)!.archives.reduce((sum,file)=>sum+file.bytes,0);
    const weightReady=(await this.store.state(model,undefined,false)).ready;
    const ready=new Map(await Promise.all(backends.map(async backend=>[backend,(await runtime.state(backend)).ready] as const)));
    if((!weightReady||backends.some(backend=>!ready.get(backend)))&&!this.usage.size)await this.options.unloadNative?.();
    const total=weightBytes+backends.reduce((sum,backend)=>sum+bytes(backend),0);
    let completed=(weightReady?weightBytes:0)+backends.reduce((sum,backend)=>sum+(ready.get(backend)?bytes(backend):0),0);
    const report=(phase:LocalModelProgress['phase'],received:number,artifact?:string)=>this.progress.set(id,{phase,received:Math.min(total,completed+received),total,artifact});
    report('checking',0);
    for(const backend of backends){
      signal.throwIfAborted();
      if(!ready.get(backend)){await runtime.install(backend,signal,value=>report(value.phase,value.received,value.artifact));completed+=bytes(backend);}
      report('checking',0);
    }
    signal.throwIfAborted();
    if(!weightReady){await this.store.install(model,signal,value=>report(value.phase,value.received,value.artifact));completed+=weightBytes;}
    signal.throwIfAborted();report('ready',0);
  }
  async cancel(id: unknown) { if (id === 'tesseract'){this.tesseract.cancel();await this.tesseract.settle();}else{const task=this.tasks.get(this.preset(id).id);task?.abort.abort();await task?.promise.catch(()=>{});} }
  async remove(id: unknown) {
    if (this.stopped) throw Error('本地模型服务已关闭');
    if (typeof id !== 'string' || this.usage.get(id)) throw Error('模型正在使用，请结束当前任务后删除');
    if (id === 'tesseract') await this.tesseract.remove();
    else {
      const preset = this.preset(id);
      if(preset.backends.includes('cuda')||preset.purpose==='formula'){
        await this.options.unloadNative?.(preset.id);
        if(this.usage.get(id))throw Error('模型正在使用，请结束当前任务后删除');
      }
      if(preset.purpose==='formula'){if(!this.options.formulas)throw Error('公式模型服务未初始化');await this.options.formulas.remove(preset.id);}else await this.store.remove(preset);
      if (preset.purpose === 'repair') {
        const root = await lstat(join(this.dataDirectory, 'models')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (root && (!root.isDirectory() || root.isSymbolicLink())) throw Error('旧模型缓存目录无效');
        await unlink(aiModelPath(this.dataDirectory, repairModel)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        this.legacyRepairReady = false;
      }
      this.states.delete(id); this.errors.delete(id); this.progress.delete(id);
    }
  }
  use(id: string) {
    this.usage.set(id, (this.usage.get(id) || 0) + 1); let released = false;
    return () => { if (released) return; released = true; const count = (this.usage.get(id) || 1) - 1; if (count) this.usage.set(id, count); else this.usage.delete(id); };
  }
  async settle() { this.devicesAbort?.abort(); this.tesseract.cancel(); for (const task of this.tasks.values()) task.abort.abort(); await Promise.allSettled([this.deviceTask, this.tesseract.settle(), ...[...this.tasks.values()].map(task => task.promise)]); }
  async stop() { this.stopped = true; await this.settle(); await this.deviceTask; }
}
