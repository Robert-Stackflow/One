import {api,errorMessage} from './ui';
import {setupShortcut} from './shortcut';
import {captureShortcutDefinitions,defaultCaptureShortcuts,type CaptureShortcutAction,type CaptureShortcuts,type CaptureShortcutState} from '../shared/capture/shortcuts';

export function captureShortcutsMarkup(){return `<h3 class="settings-section-title">全局快捷键</h3><div class="settings-card capture-shortcut-settings">${captureShortcutDefinitions.map(({id,label})=>`<div class="setting-row"><div class="setting-copy"><label for="capture-shortcut-${id}">${label}</label></div><input id="capture-shortcut-${id}" aria-label="${label}快捷键"></div>`).join('')}</div>`;}
export function setupCaptureShortcuts(root:HTMLElement,report:(error:unknown)=>void){
  let preferences=defaultCaptureShortcuts(),state:CaptureShortcutState|undefined,sequence=0,savedSequence=0;
  const dirty=new Set<CaptureShortcutAction>(),revisions=new Map<CaptureShortcutAction,number>(),saveErrors=new Map<CaptureShortcutAction,string>();
  const fields=captureShortcutDefinitions.map(({id})=>({id,input:root.querySelector<HTMLInputElement>('#capture-shortcut-'+id)!}));
  const render=()=>{if(!state)return;for(const {id,input} of fields){const match=input.value===preferences[id],saveError=saveErrors.get(id);controls.get(id)!.setStatus({active:!saveError&&match&&state.entries[id].active,error:saveError||(match?state.entries[id].error:'')});}};
  async function persist(id:CaptureShortcutAction){
    const input=fields.find(item=>item.id===id)!.input,value=input.value,request=++sequence,revision=(revisions.get(id)||0)+1;
    revisions.set(id,revision);dirty.add(id);saveErrors.delete(id);
    try{
      const saved=await api.patchSettings({capture:{shortcuts:{[id]:value}}});
      if(request>=savedSequence){savedSequence=request;preferences=saved.capture.shortcuts;}
      if(revisions.get(id)===revision){dirty.delete(id);saveErrors.delete(id);}
      state=await api.captureShortcutStatus();render();
    }catch(error){if(revisions.get(id)===revision){saveErrors.set(id,errorMessage(error));controls.get(id)!.setStatus({active:false,error:errorMessage(error)});}}
  }
  async function retry(id:CaptureShortcutAction){
    if(dirty.has(id))return persist(id);
    try{state=await api.retryCaptureShortcuts();render();}catch(error){report(error);}
  }
  const controls=new Map(fields.map(({id,input})=>[id,setupShortcut(input,report,{onRetry:()=>void retry(id)})]));
  for(const {id,input} of fields)input.addEventListener('change',()=>void persist(id));
  const unsubscribe=api.onCaptureShortcutState(next=>{state=next;render();});
  return {load(value:CaptureShortcuts){preferences=value;dirty.clear();saveErrors.clear();for(const {id,input} of fields)input.value=value[id];void api.captureShortcutStatus().then(next=>{state=next;render();}).catch(report);},dispose:unsubscribe};
}
