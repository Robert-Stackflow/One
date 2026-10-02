import {api,toast} from './ui';
import type {SettingsPatch} from '../shared/types';
/** Each field sends only its own change. The main process serializes merging and persistence. */
export function bindPreference(control:HTMLElement, patch:()=>SettingsPatch, rollback?:()=>void|Promise<void>){
  let timer:ReturnType<typeof setTimeout>|undefined,revision=0;
  const apply=()=>{clearTimeout(timer);timer=undefined;const current=++revision;try{const value=patch();void api.patchSettings(value).catch(async error=>{if(current!==revision)return;await rollback?.();toast(error);});}catch(error){toast(error);}};
  control.addEventListener('change',apply);
  window.addEventListener('blur',()=>{if(timer)apply();});
  if(control instanceof HTMLInputElement&&!['checkbox','range'].includes(control.type)&&!control.readOnly||control instanceof HTMLTextAreaElement){
    control.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(control instanceof HTMLInputElement&&!control.checkValidity())return;apply();},300);});
  }
}
