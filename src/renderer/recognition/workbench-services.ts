import {q} from '../ui';
import {updateSelectOptions,type SelectOption} from '../controls';
import type {OCRAPI,FormulaRecognitionAPI,OCRState} from '../../shared/recognition/ocr';
import type {AITaskReference,AITaskProfile} from '../../shared/ai-task';
import type {LocalModelManagerState} from '../../shared/local-models';
import type {TranslationConfig} from '../../shared/recognition/translation';
import {openWorkbenchServiceEditor} from './workbench-service-editor';
import {supportsCUDAInference} from '../../shared/inference-devices';
export type WorkbenchMode='ocr'|'translation'|'formula';
type Choice={option:SelectOption;ai?:AITaskReference;service?:{serviceId:string;revision:string};local?:string;legacy?:boolean};

/** One selector lists concrete model bindings; provider categories never become an extra navigation step. */
export function mountWorkbenchServices(api:OCRAPI,formula:FormulaRecognitionAPI,options:{
  mode():WorkbenchMode;state():OCRState|undefined;busy():boolean;changed():void;refresh():Promise<void>;
  reconfigure():Promise<void>;message(value:unknown):void;
}){
  let profiles:AITaskProfile[]=[],translation:Awaited<ReturnType<OCRAPI['dedicatedServices']>>=[],formulas:typeof translation=[];
  let local:Partial<Record<'ocr'|'formula',LocalModelManagerState>>={},configs:Partial<Record<'translation'|'formula',TranslationConfig>>={};
  let choices:Partial<Record<WorkbenchMode,string>>={},list:Choice[]=[],signature='',switching=false,loaded=false;
  try{choices.ocr=localStorage.getItem('recognition-ocr-service')||undefined;}catch{}
  const aiKey=(id:string,model:string)=>`ai:${id}:${encodeURIComponent(model)}`;
  function configKey(config?:TranslationConfig){return config?.reference?aiKey(config.reference.profileId,config.reference.model):config?.serviceReference?'service:'+config.serviceReference.serviceId:config?.ready?'legacy':undefined;}
  function items(mode:WorkbenchMode):Choice[]{
    const result:Choice[]=[];
    if(mode!=='translation')for(const entry of local[mode]?.entries||[])if(entry.purpose===mode)result.push({local:entry.id,option:{group:'本地模型',value:'local:'+entry.id,label:entry.title+' · '+entry.size+(entry.ready?'':' · 未安装')}});
    for(const profile of profiles)for(const model of profile.models)result.push({ai:{profileId:profile.id,model:model.id,revision:profile.revision},option:{group:'AI 服务',value:aiKey(profile.id,model.id),label:`${profile.name} · ${model.name||model.id}`}});
    for(const service of mode==='translation'?translation:mode==='formula'?formulas:[])result.push({service:{serviceId:service.id,revision:service.revision},option:{group:'专用服务',value:'service:'+service.id,label:service.name}});
    const config=mode==='ocr'?undefined:configs[mode];if(config?.ready&&!config.reference&&!config.serviceReference)result.push({legacy:true,option:{group:'专用服务',value:'legacy',label:'原接口 · '+(config.model||config.provider)}});
    return result;
  }
  function render(){
    const mode=options.mode();list=items(mode);
    const current=choices[mode],next=JSON.stringify([mode,list.map(item=>item.option)]);
    if(signature!==next){signature=next;updateSelectOptions(q('task-service'),[{value:'',label:list.length?'选择模型或服务':'添加服务…'},...list.map(item=>item.option)]);}
    q<HTMLSelectElement>('task-service').value=list.some(item=>item.option.value===current)?current!:'';
    q<HTMLButtonElement>('task-service').disabled=!loaded||switching||options.busy();
    q<HTMLButtonElement>('task-configure').disabled=switching||options.busy();
  }
  async function load(){
    [profiles,translation,formulas,local.ocr,local.formula,configs.translation,configs.formula]=await Promise.all([api.taskProfiles(),api.dedicatedServices(),formula.dedicatedServices(),api.localModels(false,'ocr'),api.localModels(false,'formula'),api.translationConfig(),formula.formulaConfig()]);
    const state=options.state();
    for(const mode of ['ocr','translation','formula'] as const){
      const previous=choices[mode];
      const initial=mode==='translation'?configKey(configs.translation):mode==='formula'&&state?.formulaLocal?.choice.modelId==='service'?configKey(configs.formula):'local:'+(mode==='ocr'?state?.ocrChoice?.modelId:state?.formulaLocal?.choice.modelId);
      choices[mode]=previous&&items(mode).some(item=>item.option.value===previous)?previous:initial;
    }
    loaded=true;render();
  }
  async function useFormulaService(){
    const snapshot=await api.localModels(false,'formula');
    if(snapshot.choices.formula?.modelId!=='service')await api.saveLocalModel('formula',{modelId:'service',device:{mode:'auto'}},snapshot.revision);
  }
  async function apply(choice:Choice,mode:WorkbenchMode){
    if(choice.legacy){if(mode==='formula')await useFormulaService();choices[mode]='legacy';await options.reconfigure();return true;}
    if(choice.local){
      const snapshot=await api.localModels(false,mode as 'ocr'|'formula'),entry=snapshot.entries.find(item=>item.id===choice.local);
      const choiceDevice=snapshot.choices[mode as 'ocr'|'formula']?.device;
      const nativeReady=!entry?.backends.includes('cuda')||!!entry.runtimeReady?.cpu&&(choiceDevice?.mode==='cpu'||!snapshot.devices.gpus.some(supportsCUDAInference)||!!entry.runtimeReady?.cuda);
      if(!entry?.ready||!nativeReady){await configure(mode as 'ocr'|'formula',choice.local);await options.refresh();await load();return false;}
      const purpose=mode as 'ocr'|'formula',saved=snapshot.choices[purpose];
      const device=saved?.device.mode==='gpu'&&!entry.backends.some(backend=>backend==='cuda'||backend==='dml')?{mode:'auto' as const}:saved?.device||{mode:'auto' as const};
      await api.saveLocalModel(purpose,{modelId:choice.local,device},snapshot.revision);
    }else if(mode!=='ocr'){
      if(mode==='formula'&&choice.ai)await verify(choice.ai);
      const config=mode==='translation'?await api.translationConfig():await formula.formulaConfig();
      const value={revision:config.revision,provider:choice.ai?'ai' as const:'service' as const,model:choice.ai?.model||'',endpoint:'',region:'',...(choice.ai?{reference:choice.ai}:{serviceReference:choice.service})};
      if(mode==='translation')await api.saveTranslation(value);else{
        await formula.saveFormula(value);await useFormulaService();
      }
    }
    choices[mode]=choice.option.value;if(mode==='ocr')try{localStorage.setItem('recognition-ocr-service',choice.option.value);}catch{}await options.reconfigure();return true;
  }
  async function select(){
    if(switching||options.busy())return;const mode=options.mode(),choice=items(mode).find(item=>item.option.value===q<HTMLSelectElement>('task-service').value);if(!choice)return;
    switching=true;render();options.changed();
    try{await apply(choice,mode);await options.refresh();await load();}catch(error){options.message(error);}finally{switching=false;render();options.changed();}
  }
  q('task-service').onchange=()=>void select();
  const selected=()=>items(options.mode()).find(item=>item.option.value===choices[options.mode()]);
  async function configure(purpose?:'ocr'|'formula',model?:string){
    if((switching&&!purpose)||options.busy())return;
    await openWorkbenchServiceEditor(api,{mode:purpose||options.mode(),selected:purpose?undefined:selected()?.ai?.profileId||selected()?.service?.serviceId,local:!!purpose||!!selected()?.local,model,formula,localSaved:async purpose=>{await options.refresh();choices[purpose]='local:'+(purpose==='ocr'?options.state()?.ocrChoice?.modelId:options.state()?.formulaLocal?.choice.modelId);if(purpose==='ocr')try{localStorage.setItem('recognition-ocr-service',choices.ocr!);}catch{}await load();options.changed();},migrate:selected()?.legacy?async()=>{
      const mode=options.mode();if(mode==='ocr')return;const config=configs[mode];if(!config)return;
      const ref=await (mode==='translation'?api:formula).migrateService(config.revision);await load();const key='serviceId'in ref?'service:'+ref.serviceId:aiKey(ref.profileId,ref.model),choice=items(mode).find(item=>item.option.value===key);if(!choice)throw Error('迁入的服务尚未就绪');await apply(choice,mode);await options.refresh();await load();options.changed();
    }:undefined,saved:async(kind,id)=>{
      await load();const mode=options.mode();let key=choices[mode];if(kind==='ai'&&id){const profile=profiles.find(item=>item.id===id);if(profile)key=aiKey(profile.id,profile.model);}else if(kind===mode&&id)key='service:'+id;
      const choice=items(mode).find(item=>item.option.value===key);if(choice&&!choice.local)await apply(choice,mode);await options.refresh();await load();options.changed();
    }});
    await load();await options.reconfigure();options.changed();
  }
  q('task-configure').onclick=()=>void configure().catch(options.message);
  async function verify(reference:AITaskReference){const profile=profiles.find(item=>item.id===reference.profileId);if(!profile?.imageModels.includes(reference.model)){await api.verifyServiceImage(reference);profiles=await api.taskProfiles();}}
  return {load,render,busy:()=>switching,configure,ai:()=>selected()?.ai,
    async syncLocal(purpose:'ocr'|'formula'){choices[purpose]='local:'+(purpose==='ocr'?options.state()?.ocrChoice?.modelId:options.state()?.formulaLocal?.choice.modelId);if(purpose==='ocr')try{localStorage.setItem('recognition-ocr-service',choices.ocr!);}catch{}await load();},
    ocrAI:()=>items('ocr').find(item=>item.option.value===choices.ocr)?.ai,
    ready:()=>!!selected()&&(options.mode()!=='ocr'||!selected()?.local||!!options.state()?.models.ready),
    verify,
  };
}
