import {api,esc,errorMessage,button} from './ui';
import {customControls} from './controls';
import {dialogMarkup,openDialog,closeDialog,lockDialogDismiss,confirmDialog} from './dialog';
import {formulaServiceEndpoint,type FormulaServiceProfile} from '../shared/recognition/formula-services';
import './translation-services.css';

export function mountFormulaServiceManagement(panel:HTMLElement){
  const section=document.createElement('section');section.className='translation-service-management';
  section.innerHTML=`<div class="section-heading"><h2>公式服务</h2>${button('formula-service-add','添加公式服务','plus')}</div><div id="formula-service-cards" class="ai-service-cards"></div><p id="formula-services-error" class="dialog-error" role="status" hidden></p>`;panel.append(section);
  const cards=section.querySelector<HTMLElement>('#formula-service-cards')!,error=section.querySelector<HTMLElement>('#formula-services-error')!;let profiles:FormulaServiceProfile[]=[];
  async function refresh(){
    try{profiles=await api.formulaServices();error.hidden=true;cards.innerHTML=profiles.map(profile=>`<article class="ai-service-card" data-formula-service="${esc(profile.id)}"><div class="ai-service-card-copy"><strong>${esc(profile.name)}</strong><p>SimpleTex · ${profile.mode==='turbo'?'轻量':'标准'}</p><small>${esc(profile.endpoint)}</small></div><div class="ai-service-card-actions"><button type="button" data-formula-service-edit="${esc(profile.id)}">编辑</button><button type="button" data-formula-service-remove="${esc(profile.id)}">删除</button></div></article>`).join('');}
    catch(value){error.textContent=errorMessage(value);error.hidden=false;}
  }
  function edit(profile?:FormulaServiceProfile){
    if(document.getElementById('formula-service-editor'))return;
    const holder=document.createElement('template');holder.innerHTML=dialogMarkup({id:'formula-service-editor',title:profile?'编辑公式服务':'添加公式服务',className:'one-form-dialog translation-service-editor',body:`<form id="formulator-form"><label class="field">名称<input id="formulator-name" maxlength="60" value="${esc(profile?.name||'')}" placeholder="SimpleTex" autocomplete="off"></label><label class="field">接口<select id="formulator-mode"><option value="standard">SimpleTex · 标准</option><option value="turbo">SimpleTex · 轻量</option></select></label><label class="field">APP ID<input id="formulator-app-id" maxlength="128" value="${esc(profile?.appId||'')}" autocomplete="off" spellcheck="false"></label><label class="field">APP Secret<input id="formulator-secret" type="password" maxlength="4096" autocomplete="off" spellcheck="false" placeholder="${profile?.hasKey?'已保存，留空保留':'填写个人应用的 APP Secret'}"></label><label class="field">超时（秒）<input id="formulator-timeout" type="number" min="5" max="180" value="${profile?.timeoutSeconds||45}"></label><small id="formulator-endpoint"></small><p id="formulator-error" class="dialog-error" role="status" hidden></p></form>`,actions:'<button id="formulator-save" type="submit" form="formulator-form" class="primary">保存</button>'});
    const dialog=holder.content.firstElementChild as HTMLDialogElement;document.body.append(dialog);
    const q=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>('#formulator-'+id)!,input=(id:string)=>q<HTMLInputElement>(id);let saving=false;
    input('mode').value=profile?.mode||'standard';
    const fields=()=>{q('endpoint').textContent=formulaServiceEndpoint(input('mode').value as 'standard'|'turbo');};input('mode').onchange=fields;fields();customControls(dialog);openDialog(dialog);
    dialog.addEventListener('close',()=>{input('secret').value='';dialog.remove();});
    q<HTMLFormElement>('form').onsubmit=event=>{
      event.preventDefault();if(saving)return;saving=true;const unlock=lockDialogDismiss(dialog);
      const controls=dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select');for(const control of controls)control.disabled=true;
      void(async()=>{try{
        const appSecret=input('secret').value.trim();await api.saveFormulaService({id:profile?.id,revision:profile?.revision,name:input('name').value.trim()||'SimpleTex',provider:'simpletex',mode:input('mode').value as 'standard'|'turbo',appId:input('app-id').value.trim(),timeoutSeconds:Number(input('timeout').value),...(appSecret?{appSecret}:{})});
        unlock();await closeDialog(dialog);await refresh();
      }catch(value){q('error').textContent=errorMessage(value);q('error').hidden=false;}
      finally{unlock();saving=false;for(const control of controls)control.disabled=false;}})();
    };
  }
  section.querySelector('#formula-service-add')!.addEventListener('click',()=>edit());
  section.addEventListener('click',event=>{
    const node=event.target instanceof Element?event.target.closest<HTMLElement>('[data-formula-service-edit],[data-formula-service-remove]'):null;if(!node)return;
    const id=node.dataset.formulaServiceEdit||node.dataset.formulaServiceRemove,profile=profiles.find(item=>item.id===id);if(!profile)return;
    if(node.dataset.formulaServiceEdit)edit(profile);else void(async()=>{if(await confirmDialog({title:'删除公式服务',message:`删除「${profile.name}」及其密钥？`,confirm:'删除',danger:true})){try{await api.removeFormulaService(profile.id,profile.revision);await refresh();}catch(value){error.textContent=errorMessage(value);error.hidden=false;}}})();
  });
  return {refresh};
}
