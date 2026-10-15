import {esc} from '../ui';
import {customControls} from '../controls';
import {dialogMarkup,openDialog,closeDialog,lockDialogDismiss} from '../dialog';
import type {OCRAPI,WorkbenchServiceCatalog} from '../../shared/recognition/ocr';
import type {AIKind,AIProfile} from '../../shared/ai';
import type {WorkbenchMode} from './workbench-services';
import './workbench-services.css';
import {setupSegments} from '../segments';

/** Edits the shared service stores in-place; no renderer navigation or copied credentials. */
export async function openWorkbenchServiceEditor(api:OCRAPI,options:{mode:WorkbenchMode;selected?:string;models():Promise<void>;migrate?:()=>Promise<void>;saved(kind?:'ai'|'translation'|'formula',id?:string):Promise<void>}){
  const wrapper=document.createElement('div');wrapper.innerHTML=dialogMarkup({id:'workbench-service-settings',title:'服务配置',className:'one-form-dialog workbench-service-settings',body:`
    <div class="service-editor-toolbar"><div class="tabs" role="tablist" aria-label="服务类型"><button type="button" data-kind="ai">AI 服务</button><button type="button" data-kind="translation">专用翻译</button><button type="button" data-kind="formula">专用公式</button></div><button type="button" data-add class="quiet">添加服务</button><button type="button" data-models class="quiet"${options.mode==='translation'?' hidden':''}>本地模型</button></div>
    <div class="service-editor-browser"><nav aria-label="服务列表" class="service-editor-list"></nav><form id="workbench-service-form" class="service-editor-form"></form></div><p class="dialog-error" role="status" hidden></p>`,actions:'<button type="submit" form="workbench-service-form" class="primary" data-save>保存服务</button>'});
  const dialog=wrapper.firstElementChild as HTMLDialogElement;document.body.append(dialog);
  const segments=setupSegments(dialog);
  if(options.migrate){const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='迁入原配置';dialog.querySelector('.service-editor-toolbar')!.append(button);button.onclick=()=>{button.disabled=true;const unlock=lockDialogDismiss(dialog);void options.migrate!().then(async()=>{unlock();await closeDialog(dialog);}).catch(fail).finally(()=>{unlock();button.disabled=false;});};}
  const list=dialog.querySelector<HTMLElement>('.service-editor-list')!,form=dialog.querySelector<HTMLFormElement>('form')!,error=dialog.querySelector<HTMLElement>('.dialog-error')!,save=dialog.querySelector<HTMLButtonElement>('[data-save]')!;
  let catalog:WorkbenchServiceCatalog={ai:[],translation:[],formula:[]},kind:'ai'|'translation'|'formula'=options.mode==='ocr'?'ai':options.mode,id=options.selected||'',saving=false,closed=false;
  const fields=(label:string,control:string)=>`<label class="field" data-field="${esc(/name="([^"]+)/.exec(control)?.[1]||'')}">${label}${control}</label>`;
  const input=(key:string,value:string|number='',type='text',placeholder='')=>`<input name="${key}" type="${type}" value="${esc(String(value))}" placeholder="${esc(placeholder)}" autocomplete="${type==='password'?'new-password':'off'}">`;
  const select=(key:string,items:[string,string][])=>`<select name="${key}">${items.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>`;
  const value=(key:string)=>(form.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${key}"]`)?.value||'').trim();
  const record=()=>catalog[kind].find(item=>item.id===id);
  function fail(reason:unknown){error.textContent=reason instanceof Error?reason.message:String(reason);error.hidden=!error.textContent;}
  function render(){
    if(closed)return;
    for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-kind]')){const selected=button.dataset.kind===kind;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));}
    list.replaceChildren();for(const item of catalog[kind]){const button=document.createElement('button');button.type='button';button.className='service-editor-item';button.classList.toggle('selected',item.id===id);const name=document.createElement('strong'),detail=document.createElement('span');name.textContent=item.name;detail.textContent='kind'in item?item.kind:'provider'in item?item.provider:'';button.append(name,detail);button.onclick=()=>{id=item.id;render();};list.append(button);}
    const current=record();
    form.innerHTML=fields('服务名称',input('name',current?.name||''));
    if(kind==='ai'){
      const profile=current as AIProfile|undefined;
      form.insertAdjacentHTML('beforeend',fields('接口类型',select('provider',[['openai','OpenAI 兼容接口'],['ollama','Ollama'],['lmstudio','LM Studio'],['codex','Codex（本机）']]))+fields('基础地址',input('base',profile?.baseUrl||'https://api.openai.com/v1','url'))+fields('默认模型 ID',input('model',profile?.model||''))+fields('模型列表（每行一个 ID）',`<textarea name="models" rows="4" spellcheck="false">${esc(profile?.models.map(model=>model.id).join('\n')||'')}</textarea>`)+fields('API 密钥',input('key','','password',profile?.hasKey?'已保存，留空保留':'本机服务可留空')));
      form.querySelector<HTMLSelectElement>('[name="provider"]')!.value=profile?.kind||'openai';
      const fetchModels=document.createElement('button');fetchModels.type='button';fetchModels.className='quiet service-editor-fetch';fetchModels.textContent='读取模型';form.querySelector('[data-field="models"]')!.append(fetchModels);
      fetchModels.onclick=()=>{if(fetchModels.disabled)return;fetchModels.disabled=true;fetchModels.textContent='读取中…';void api.aiModelCatalogDraft({id:id||undefined,kind:value('provider') as AIKind,baseUrl:value('provider')==='codex'?'codex://local':value('base'),apiKey:value('key')||undefined,timeoutSeconds:Number(value('timeout'))}).then(models=>{if(closed)return;const field=form.querySelector<HTMLTextAreaElement>('[name="models"]')!;field.value=[...new Set(value('models').split(/\r?\n/).filter(Boolean).concat(models.map(model=>model.id)))].join('\n');if(!value('model')&&models[0])form.querySelector<HTMLInputElement>('[name="model"]')!.value=models[0].id;}).catch(reason=>{if(!closed)fail(reason);}).finally(()=>{if(!closed){fetchModels.disabled=false;fetchModels.textContent='读取模型';}});};
      const toggle=()=>{const local=value('provider')==='codex';for(const key of ['base','key'])form.querySelector(`[name="${key}"]`)!.parentElement!.hidden=local;};
      form.querySelector('[name="provider"]')!.addEventListener('change',toggle);toggle();
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
    const timeout=form.querySelector<HTMLInputElement>('[name="timeout"]')!;timeout.min='5';timeout.max=kind==='ai'?'300':'180';
    customControls(dialog);save.disabled=false;fail('');
  }
  for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-kind]'))button.onclick=()=>{if(saving)return;kind=button.dataset.kind as typeof kind;id=catalog[kind][0]?.id||'';render();};
  dialog.querySelector<HTMLButtonElement>('[data-add]')!.onclick=()=>{if(!saving){id='';render();}};
  dialog.querySelector<HTMLButtonElement>('[data-models]')!.onclick=()=>void closeDialog(dialog).then(()=>options.models()).catch(fail);
  form.onsubmit=event=>{event.preventDefault();if(saving)return;saving=true;const unlock=lockDialogDismiss(dialog);for(const node of dialog.querySelectorAll<HTMLButtonElement>('button'))node.disabled=true;
    void(async()=>{try{
      if(kind==='ai'){
        const current=catalog.ai.find(item=>item.id===id),provider=value('provider') as AIKind,model=value('model'),ids=[...new Set(value('models').split(/\r?\n/).map(item=>item.trim()).filter(Boolean).concat(model?[model]:[]))];
        const {hasKey:_,...previous}=current||{} as AIProfile;
        id=await api.saveAIService({...previous,id:id||undefined,name:value('name'),kind:provider,baseUrl:provider==='codex'?'codex://local':value('base'),model,models:ids.map(id=>current?.models.find(item=>item.id===id)||{id,name:id}),timeoutSeconds:Number(value('timeout')),maxTokens:current?.maxTokens||8192,temperature:current?.temperature??null,tokenField:current?.tokenField||'max_tokens',apiKey:provider==='codex'?undefined:value('key')||undefined});
      }else{
        const current=record(),base={id:id||undefined,revision:current&&'revision'in current?current.revision:undefined,name:value('name'),timeoutSeconds:Number(value('timeout'))};
        const result=await api.saveDedicatedService(kind,kind==='formula'?{...base,provider:'simpletex',mode:value('mode') as 'standard'|'turbo',appId:value('appId'),appSecret:value('key')||undefined}:{...base,provider:value('provider') as 'azure'|'deepl'|'google'|'baidu',region:value('provider')==='azure'?value('region'):'',plan:value('plan') as 'pro'|'free',...(value('provider')==='baidu'?{appId:value('appId')}:{ }),apiKey:value('key')||undefined});
        id=(result as {id:string}).id;
      }
      form.querySelector<HTMLInputElement>('[name="key"]')!.value='';await options.saved(kind,id);unlock();await closeDialog(dialog);
    }catch(reason){fail(reason);}finally{unlock();saving=false;for(const node of dialog.querySelectorAll<HTMLButtonElement>('button'))node.disabled=false;}})();
  };
  dialog.addEventListener('close',()=>{closed=true;segments.dispose();for(const key of form.querySelectorAll<HTMLInputElement>('input[type="password"]'))key.value='';dialog.remove();},{once:true});
  save.disabled=true;await openDialog(dialog);
  try{catalog=await api.serviceCatalog();if(closed)return;if(id){if(catalog.ai.some(item=>item.id===id))kind='ai';else if(catalog.translation.some(item=>item.id===id))kind='translation';else if(catalog.formula.some(item=>item.id===id))kind='formula';}render();}catch(reason){fail(reason);}
}
