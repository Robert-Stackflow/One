import {q} from '../ui';
import {customControls,updateSelectOptions} from '../controls';
import {dialogMarkup,openDialog,closeDialog,lockDialogDismiss} from '../dialog';
import type {TranslationConfig,TranslationSettings,TranslationProvider} from '../../shared/recognition/translation';
import type {AITaskProfile,AITaskReference} from '../../shared/ai-task';
import type {TranslationServiceProfile,TranslationServiceReference} from '../../shared/recognition/translation-services';
import './service-settings.css';

export function mountServiceSettings(prefix:'translation'|'formula',options:{
  load():Promise<TranslationConfig>;save(value:TranslationSettings):Promise<TranslationConfig>;clear(revision:string):Promise<TranslationConfig>;
  profiles():Promise<AITaskProfile[]>;verify(reference:AITaskReference):Promise<void>;cancelCheck():Promise<void>;
  services():Promise<TranslationServiceProfile[]>;migrate(revision:string):Promise<AITaskReference|TranslationServiceReference>;restore(revision:string):Promise<TranslationConfig>;manage():Promise<void>;
  available():boolean;updated(value:TranslationConfig,notice:string):void;error(value:unknown):void;
}){
  const formula=prefix==='formula',label=formula?'公式识别':'翻译',dialog=q<HTMLDialogElement>(prefix+'-settings'),modal=formula?'formula-modal':'modal';
  let config:TranslationConfig|undefined,profiles:AITaskProfile[]=[],services:TranslationServiceProfile[]=[],busy=false,opening=false,serial=0,locked=false;
  const field=<T extends HTMLElement>(id:string)=>dialog.querySelector<T>('#'+id)!;
  const control=(name:string)=>field<HTMLInputElement>(prefix+'-'+name);
  const body=`<section class="service-settings-section"><label class="field">服务来源<select id="${prefix}-provider"><option value="ai">One AI 服务</option></select></label><div id="${prefix}-ai-fields" class="service-settings-section"><div class="service-settings-heading"><h3>服务与模型</h3><button id="${prefix}-manage" type="button" class="quiet">管理服务 ↗</button></div><label class="field">服务<select id="${prefix}-profile"></select></label><label class="field">模型<select id="${prefix}-task-model"></select></label>${formula?`<div class="service-check"><span id="${prefix}-vision-status"></span><button id="${prefix}-verify" type="button" class="quiet">验证图片输入</button></div>`:''}</div><div id="${prefix}-legacy-fields" class="service-settings-section" hidden><div class="service-settings-heading"><h3>原独立接口</h3></div><dl id="${prefix}-legacy-details" class="service-legacy-details"></dl><span class="service-secret-note">原配置继续可用；迁入后保存服务选择。</span><button id="${prefix}-migrate" type="button" class="quiet" hidden>迁入 One AI 服务</button></div><button id="${prefix}-restore" type="button" class="quiet" hidden>恢复原独立接口</button></section>`;
  const template=document.createElement('template');
  template.innerHTML=dialogMarkup({id:prefix+'-settings',title:label+'服务',titleId:modal+'-title',closeId:modal+'-close',className:'one-form-dialog recognition-settings',body:`<form id="${prefix}-form" novalidate>${body}<p id="${modal}-error" class="dialog-error" role="status"></p></form>`,actions:`<button id="${prefix}-remove" type="button" class="quiet" hidden>移除配置</button><button id="${prefix}-save" type="submit" form="${prefix}-form" class="primary">保存配置</button>`});
  dialog.replaceChildren(...template.content.firstElementChild!.childNodes);dialog.classList.add('recognition-settings');
  const dedicated=document.createElement('section');dedicated.id=prefix+'-service-fields';dedicated.className='service-settings-section';dedicated.hidden=true;
  if(!formula){field<HTMLSelectElement>(prefix+'-provider').append(new Option('专用翻译服务','service'));
    dedicated.innerHTML=`<div class="service-settings-heading"><h3>翻译服务</h3><button id="${prefix}-service-manage" type="button" class="quiet">管理服务 ↗</button></div><label class="field">服务<select id="${prefix}-service-choice"></select></label><span id="${prefix}-service-endpoint" class="service-secret-note"></span>`;
    field(prefix+'-ai-fields').insertAdjacentElement('afterend',dedicated);field(prefix+'-service-manage').onclick=()=>{void options.manage().catch(error);};
  }
  const error=(value:unknown)=>{const node=field(modal+'-error');node.textContent=value instanceof Error?value.message:String(value||'');node.hidden=!node.textContent;};
  function reference():AITaskReference|undefined{
    const profile=profiles.find(item=>item.id===control('profile').value),model=control('task-model').value;
    return profile&&profile.models.some(item=>item.id===model)?{profileId:profile.id,model,revision:profile.revision}:undefined;
  }
  function fields(){
    const provider=control('provider').value,ai=provider==='ai',service=provider==='service',azure=provider==='azure',ref=reference();
    field(prefix+'-ai-fields').hidden=!ai;field(prefix+'-legacy-fields').hidden=ai||service;dedicated.hidden=!service;
    if(!formula)field(prefix+'-service-endpoint').textContent=services.find(item=>item.id===control('service-choice').value)?.endpoint||'';
    field(prefix+'-migrate').hidden=ai||service||!['chat','azure'].includes(provider)||!config?.ready||config.provider!==provider;field(prefix+'-migrate').textContent=azure?'迁入统一翻译服务':'迁入 One AI 服务';
    field(prefix+'-restore').hidden=!config?.canRestoreLegacy;
    if(formula){const verified=!!ref&&!!profiles.find(item=>item.id===ref.profileId)?.imageModels.includes(ref.model);
      field(prefix+'-vision-status').textContent=verified?'图片输入已验证':ref?'需验证图片输入':'请选择服务与模型';
      field<HTMLButtonElement>(prefix+'-verify').disabled=busy||opening||!ref||verified;
      field<HTMLButtonElement>(prefix+'-save').disabled=busy||opening||!ai||!verified;
    }else field<HTMLButtonElement>(prefix+'-save').disabled=busy||opening||(!ai&&!service)||(ai&&!ref)||(service&&!serviceReference());
  }
  function serviceReference():TranslationServiceReference|undefined{const profile=services.find(item=>item.id===control('service-choice').value);return profile?.hasKey?{serviceId:profile.id,revision:profile.revision}:undefined;}
  function serviceOptions(ref?:TranslationServiceReference){if(formula)return;updateSelectOptions(control('service-choice'),services.map(item=>({label:item.name,value:item.id})));control('service-choice').value=ref?.serviceId||services[0]?.id||'';fields();}
  function models(preferred?:string){
    const profile=profiles.find(item=>item.id===control('profile').value);
    updateSelectOptions(control('task-model'),profile?.models.map(item=>({label:item.name||item.id,value:item.id}))||[]);
    control('task-model').value=preferred||profile?.model||profile?.models[0]?.id||'';fields();
  }
  function profileOptions(ref?:AITaskReference){
    updateSelectOptions(control('profile'),profiles.map(item=>({label:item.name,value:item.id})));
    control('profile').value=ref?.profileId||profiles[0]?.id||'';models(ref?.model);
  }
  function disabled(value:boolean){for(const node of dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select'))node.disabled=value;dialog.querySelector('form')!.ariaBusy=String(value);}
  async function open(){
    if(busy||opening||!options.available())return;
    opening=true;const ticket=++serial;error('');openDialog(dialog);disabled(true);field<HTMLButtonElement>(modal+'-close').disabled=false;
    try{
      const values=await Promise.all([options.load(),options.profiles(),formula?Promise.resolve([]):options.services()]);if(ticket!==serial||!dialog.open)return;
      [config,profiles,services]=values;options.updated(config,'');
      updateSelectOptions(field<HTMLSelectElement>(prefix+'-provider'),[
        {label:'One AI 服务',value:'ai'},...(!formula?[{label:'专用翻译服务',value:'service'}]:[]),
        ...((config.keySaved||config.endpoint||config.region)&&['chat','azure'].includes(config.provider)&&(!formula||config.provider==='chat')?[{label:'原独立接口',value:config.provider}]:[])
      ]);
      control('provider').value=config.provider;
      if(!config.ready&&!config.keySaved&&!['ai','service'].includes(config.provider))control('provider').value=!profiles.length&&services.length?'service':'ai';
      const details=field(prefix+'-legacy-details');details.replaceChildren();
      for(const [name,value] of config.provider==='azure'?[['服务','Azure Translator'],['区域',config.region]]:[['接口地址',config.endpoint],['模型',config.model]]){
        const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=name;description.textContent=value;details.append(term,description);
      }
      field(prefix+'-remove').hidden=!config.keySaved&&!['ai','service'].includes(config.provider);profileOptions(config.reference);serviceOptions(config.serviceReference);error(config.error);customControls(dialog);
    }catch(value){if(ticket===serial)error(value);}finally{if(ticket===serial){opening=false;disabled(false);fields();}}
  }
  control('provider').onchange=fields;control('profile').onchange=()=>models();control('task-model').onchange=fields;
  if(!formula)control('service-choice').onchange=fields;
  field(modal+'-close').onclick=()=>{if(!locked){void options.cancelCheck().catch(options.error);void closeDialog(dialog);}};
  dialog.addEventListener('cancel',event=>{if(locked)event.preventDefault();else void options.cancelCheck().catch(options.error);});
  dialog.addEventListener('close',()=>{serial++;opening=false;void options.cancelCheck().catch(options.error);});
  async function operation(action:(unlock:()=>void)=>Promise<void>,dismissLock=false){
    if(busy||opening)return;busy=true;locked=dismissLock;disabled(true);error('');const unlock=dismissLock?lockDialogDismiss(dialog):()=>{};const ticket=serial;
    if(!dismissLock)field<HTMLButtonElement>(modal+'-close').disabled=false;
    try{await action(unlock);}catch(value){if(ticket===serial)error(value);}finally{unlock();busy=false;locked=false;disabled(false);fields();}
  }
  field(prefix+'-manage').onclick=()=>{void options.manage().catch(error);};
  field(prefix+'-migrate').onclick=()=>void operation(async()=>{
    if(!config)return;const ref=await options.migrate(config.revision);
    if('serviceId' in ref){services=await options.services();serviceOptions(ref);control('provider').value='service';}else{profiles=await options.profiles();profileOptions(ref);control('provider').value='ai';}fields();
  },true);
  field(prefix+'-restore').onclick=()=>void operation(async unlock=>{if(!config)return;config=await options.restore(config.revision);options.updated(config,'');unlock();await closeDialog(dialog);},true);
  if(formula)field(prefix+'-verify').onclick=()=>void operation(async()=>{
    const ref=reference(),ticket=serial;if(!ref)return;field(prefix+'-vision-status').textContent='正在验证…';await options.verify(ref);if(ticket!==serial)return;
    profiles=await options.profiles();config=await options.load();options.updated(config,'');fields();
  });
  async function save(remove=false){
    if(!config)return;
    await operation(async unlock=>{
      if(!config)return;const provider=control('provider').value as TranslationProvider,ref=reference();
      if(!remove&&!['ai','service'].includes(provider))throw Error('请迁入或选择统一服务');
      if(!remove&&provider==='ai'&&!ref)throw Error('请选择服务与模型');
      if(!remove&&provider==='service'&&!serviceReference())throw Error('请选择翻译服务');
      config=remove?await options.clear(config.revision):await options.save(provider==='ai'?{revision:config.revision,provider,endpoint:'',region:'',model:ref!.model,reference:ref}:{revision:config.revision,provider:'service',endpoint:'',region:'',model:'',serviceReference:serviceReference()});
      options.updated(config,'');unlock();await closeDialog(dialog);
    },true);
  }
  dialog.querySelector('form')!.onsubmit=event=>{event.preventDefault();void save();};field(prefix+'-remove').onclick=()=>void save(true);
  customControls(dialog);fields();
  const initialSerial=serial;void options.load().then(value=>{if(initialSerial===serial&&!dialog.open){config=value;options.updated(value,'');}}).catch(options.error);
  return {open};
}
