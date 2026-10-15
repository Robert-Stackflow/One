import {mountAIProfileForm,type AIProfileEditorAPI} from '../ai-profile-editor';
import {mountLocalModels} from './local-models-ui';
import {esc} from '../ui';
import {customControls} from '../controls';
import {dialogMarkup,openDialog,closeDialog,lockDialogDismiss} from '../dialog';
import type {OCRAPI,FormulaRecognitionAPI,WorkbenchServiceCatalog} from '../../shared/recognition/ocr';
import type {AIProfile} from '../../shared/ai';
import type {WorkbenchMode} from './workbench-services';
import './workbench-services.css';
import {setupSegments} from '../segments';

/** Edits the shared service stores in-place; no renderer navigation or copied credentials. */
export async function openWorkbenchServiceEditor(api:OCRAPI,options:{mode:WorkbenchMode;selected?:string;local?:boolean;model?:string;formula:FormulaRecognitionAPI;localSaved(purpose:'ocr'|'formula'):Promise<void>;migrate?:()=>Promise<void>;saved(kind?:'ai'|'translation'|'formula',id?:string):Promise<void>}){
  const existing=document.getElementById('workbench-service-settings');if(existing){existing.focus();return;}
  const wrapper=document.createElement('div');wrapper.innerHTML=dialogMarkup({id:'workbench-service-settings',title:'服务配置',className:'one-form-dialog workbench-service-settings',body:`
    <div class="service-editor-toolbar"><div class="tabs" role="tablist" aria-label="服务类型"><button type="button" role="tab" data-kind="ocr-model">OCR 模型</button><button type="button" role="tab" data-kind="formula-model">公式识别模型</button><button type="button" role="tab" data-kind="ai">AI 服务</button><button type="button" role="tab" data-kind="translation">翻译服务</button><button type="button" role="tab" data-kind="formula">公式识别服务</button></div><button type="button" data-add class="quiet">添加服务</button></div>
    <section class="service-model-panel" data-model-panel="ocr" hidden></section><section class="service-model-panel" data-model-panel="formula" hidden></section><div class="service-editor-browser"><nav aria-label="服务列表" class="service-editor-list"></nav><form id="workbench-service-form" class="service-editor-form"></form></div><p class="dialog-error" role="status" hidden></p>`,actions:'<span data-model-actions="ocr" hidden></span><span data-model-actions="formula" hidden></span><button type="submit" form="workbench-service-form" class="primary" data-save>保存服务</button>'});
  const dialog=wrapper.firstElementChild as HTMLDialogElement;document.body.append(dialog);
  const segments=setupSegments(dialog);
  if(options.migrate){const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='迁入原配置';dialog.querySelector('.service-editor-toolbar')!.append(button);button.onclick=()=>{button.disabled=true;const unlock=lockDialogDismiss(dialog);void options.migrate!().then(async()=>{unlock();await closeDialog(dialog);}).catch(fail).finally(()=>{unlock();button.disabled=false;});};}
  const list=dialog.querySelector<HTMLElement>('.service-editor-list')!,form=dialog.querySelector<HTMLFormElement>('form')!,error=dialog.querySelector<HTMLElement>('.dialog-error')!,save=dialog.querySelector<HTMLButtonElement>('[data-save]')!;
  let catalog:WorkbenchServiceCatalog={ai:[],translation:[],formula:[]},kind:'ocr-model'|'formula-model'|'ai'|'translation'|'formula'=options.local?(options.mode==='formula'?'formula-model':'ocr-model'):options.mode==='ocr'?'ai':options.mode,id=options.selected||'',saving=false,closed=false,catalogReady=false;
  let aiForm:ReturnType<typeof mountAIProfileForm>|undefined;
  const panels=new Map<'ocr'|'formula',ReturnType<typeof mountLocalModels>>();
  const editorAPI:AIProfileEditorAPI={...api,aiProfile:value=>api.saveAIService(value)};
  const fields=(label:string,control:string)=>`<label class="field" data-field="${esc(/name="([^"]+)/.exec(control)?.[1]||'')}">${label}${control}</label>`;
  const input=(key:string,value:string|number='',type='text',placeholder='')=>`<input name="${key}" type="${type}" value="${esc(String(value))}" placeholder="${esc(placeholder)}" autocomplete="${type==='password'?'new-password':'off'}">`;
  const select=(key:string,items:[string,string][])=>`<select name="${key}">${items.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>`;
  const value=(key:string)=>(form.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${key}"]`)?.value||'').trim();
  const record=()=>kind==='ocr-model'||kind==='formula-model'?undefined:catalog[kind].find(item=>item.id===id);
  function fail(reason:unknown){error.textContent=reason instanceof Error?reason.message:String(reason);error.hidden=!error.textContent;}
  function render(){
    if(closed)return;
    for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-kind]')){const selected=button.dataset.kind===kind;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));}
    aiForm?.dispose();aiForm=undefined;
    const purpose=kind==='ocr-model'?'ocr':kind==='formula-model'?'formula':undefined;
    for(const panel of dialog.querySelectorAll<HTMLElement>('[data-model-panel]'))panel.hidden=panel.dataset.modelPanel!==purpose;
    for(const action of dialog.querySelectorAll<HTMLElement>('[data-model-actions]'))action.hidden=action.dataset.modelActions!==purpose;
    dialog.querySelector<HTMLElement>('.service-editor-browser')!.hidden=!!purpose;save.hidden=!!purpose;
    dialog.querySelector<HTMLElement>('[data-add]')!.hidden=!!purpose;fail('');
    if(purpose){
      if(!panels.has(purpose))panels.set(purpose,mountLocalModels(purpose==='ocr'?api:options.formula,()=>options.localSaved(purpose),purpose,{host:dialog.querySelector<HTMLElement>(`[data-model-panel="${purpose}"]`)!,actions:dialog.querySelector<HTMLElement>(`[data-model-actions="${purpose}"]`)!,dialog,selected:options.model,active:()=>kind===purpose+'-model'}));
      void panels.get(purpose)!().catch(fail);return;
    }
    if(kind==='ocr-model'||kind==='formula-model')return;
    if(!catalogReady){list.replaceChildren();form.innerHTML='<div class="model-dialog-loading" role="status" aria-label="读取服务"><span class="model-action-spinner" aria-hidden="true"></span></div>';save.disabled=true;return;}
    list.replaceChildren();for(const item of catalog[kind]){const button=document.createElement('button');button.type='button';button.className='service-editor-item';button.classList.toggle('selected',item.id===id);const name=document.createElement('strong'),detail=document.createElement('span');name.textContent=item.name;detail.textContent='kind'in item?item.kind:'provider'in item?item.provider:'';button.append(name,detail);button.onclick=()=>{id=item.id;render();};list.append(button);}
    const current=record();
    form.classList.remove('ai-profile-form');form.classList.add('service-editor-form');form.innerHTML=fields('服务名称',input('name',current?.name||''));
    if(kind==='ai'){
      form.classList.remove('service-editor-form');aiForm=mountAIProfileForm(form,current as AIProfile|undefined,editorAPI);save.disabled=false;return;
    }else if(kind==='translation'){
      const profile=catalog.translation.find(item=>item.id===id);
      form.insertAdjacentHTML('beforeend',fields('接口类型',select('provider',[['azure','Azure Translator'],['deepl','DeepL'],['google','Google Cloud Translation'],['baidu','百度翻译']]))+fields('区域',input('region',profile?.region||''))+fields('套餐',select('plan',[['pro','Pro'],['free','Free']]))+fields('APPID',input('appId',profile?.appId||''))+fields('密钥',input('key','','password',profile?.hasKey?'已保存，留空保留':'')));
      form.querySelector<HTMLSelectElement>('[name="provider"]')!.value=profile?.provider||'azure';form.querySelector<HTMLSelectElement>('[name="plan"]')!.value=profile?.plan||'pro';
      const toggle=()=>{for(const [key,visible]of [['region',value('provider')==='azure'],['plan',value('provider')==='deepl'],['appId',value('provider')==='baidu']]as const)form.querySelector(`[name="${key}"]`)!.parentElement!.hidden=!visible;};
      form.querySelector('[name="provider"]')!.addEventListener('change',toggle);toggle();
    }else{
      const profile=catalog.formula.find(item=>item.id===id);
      form.insertAdjacentHTML('beforeend',fields('SimpleTex 接口',select('mode',[['standard','标准'],['turbo','Turbo']]))+fields('APP ID',input('appId',profile?.appId||''))+fields('APP Secret',input('key','','password',profile?.hasKey?'已保存，留空保留':'')));
      form.querySelector<HTMLSelectElement>('[name="mode"]')!.value=profile?.mode||'standard';
    }
    form.insertAdjacentHTML('beforeend',fields('超时（秒）',input('timeout',current?.timeoutSeconds||90,'number')));
    const timeout=form.querySelector<HTMLInputElement>('[name="timeout"]')!;timeout.min='5';timeout.max='180';
    customControls(dialog);save.disabled=false;fail('');
  }
  for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-kind]'))button.onclick=()=>{if(saving)return;kind=button.dataset.kind as typeof kind;id=kind==='ocr-model'||kind==='formula-model'?'':catalog[kind][0]?.id||'';render();};
  dialog.querySelector<HTMLButtonElement>('[data-add]')!.onclick=()=>{if(!saving&&catalogReady){id='';render();}};
  form.onsubmit=event=>{event.preventDefault();if(!catalogReady||saving||kind==='ocr-model'||kind==='formula-model')return;const serviceKind=kind;saving=true;const unlock=lockDialogDismiss(dialog),disabled=new Map([...dialog.querySelectorAll<HTMLButtonElement>('button')].map(node=>[node,node.disabled]));for(const node of disabled.keys())node.disabled=true;
    void(async()=>{try{
      if(serviceKind==='ai'){
        id=await aiForm!.save();
      }else{
        const current=record(),base={id:id||undefined,revision:current&&'revision'in current?current.revision:undefined,name:value('name'),timeoutSeconds:Number(value('timeout'))};
        const result=await api.saveDedicatedService(serviceKind,kind==='formula'?{...base,provider:'simpletex',mode:value('mode') as 'standard'|'turbo',appId:value('appId'),appSecret:value('key')||undefined}:{...base,provider:value('provider') as 'azure'|'deepl'|'google'|'baidu',region:value('provider')==='azure'?value('region'):'',plan:value('plan') as 'pro'|'free',...(value('provider')==='baidu'?{appId:value('appId')}:{ }),apiKey:value('key')||undefined});
        id=(result as {id:string}).id;
      }
      const key=form.querySelector<HTMLInputElement>('[name="key"]');if(key)key.value='';await options.saved(serviceKind,id);unlock();await closeDialog(dialog);
    }catch(reason){fail(reason);}finally{unlock();saving=false;for(const [node,wasDisabled]of disabled)node.disabled=wasDisabled;}})();
  };
  dialog.addEventListener('close',()=>{closed=true;segments.dispose();aiForm?.dispose();for(const panel of panels.values())panel.dispose();for(const key of form.querySelectorAll<HTMLInputElement>('input[type="password"]'))key.value='';dialog.remove();},{once:true});
  save.disabled=true;openDialog(dialog);render();
  try{catalog=await api.serviceCatalog();if(closed)return;catalogReady=true;if(options.selected&&id===options.selected){if(catalog.ai.some(item=>item.id===id))kind='ai';else if(catalog.translation.some(item=>item.id===id))kind='translation';else if(catalog.formula.some(item=>item.id===id))kind='formula';}if(kind!=='ocr-model'&&kind!=='formula-model')render();}catch(reason){fail(reason);}
}
