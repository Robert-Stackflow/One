import type {NativePreviewBounds,NativePreviewState} from '../shared/native-preview';
import {api,esc,icon,toast} from './ui';
export function renderNativeOffice(host:HTMLElement,token:string){
 let disposed=false,frame=0,starting=false;
 host.classList.add('native-office-preview');
 const bounds=():NativePreviewBounds=>{const r=host.getBoundingClientRect(),covered=!!document.querySelector('#preview-open-popover:not([hidden]),#preview-more-popover:not([hidden]),dialog[open]');return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:covered?0:Math.max(0,r.width),height:covered?0:Math.max(0,r.height)};};
 const show=(state:NativePreviewState)=>{if(disposed||state.token!==token)return;if(state.status==='ready'){host.replaceChildren();host.setAttribute('aria-label','原生工作簿预览');return;}host.removeAttribute('aria-label');
  host.innerHTML=`<div class="preview-unsupported">${icon('file')}<h2>无法预览工作簿</h2><p class="preview-error-detail">${esc(state.message||'原生预览组件不可用')}</p><div class="native-preview-actions"><button id="native-preview-retry">${icon('refresh')}重试</button><button id="native-preview-open">${icon('open')}用默认程序打开</button></div></div>`;
  host.querySelector<HTMLButtonElement>('#native-preview-retry')!.onclick=()=>{void api.nativePreviewStop(token).then(start).catch(toast);};host.querySelector<HTMLButtonElement>('#native-preview-open')!.onclick=()=>document.getElementById('preview-open')?.click();
 };
 const start=async()=>{if(disposed||starting)return;starting=true;host.removeAttribute('aria-label');host.innerHTML=`<div class="preview-loading">${icon('file')}<span>正在加载原生工作簿预览…</span></div>`;try{show(await api.nativePreviewStart(token,bounds()));}catch(error){console.warn('Native preview failed',error);show({token,status:'error',message:'原生预览无法启动。可以重试，或用默认程序打开。'});}finally{starting=false;}};
 const remove=api.onNativePreviewState(show);
 const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!disposed)void api.nativePreviewBounds(token,bounds()).catch(()=>{});});};
 const observer=new ResizeObserver(update);observer.observe(host);window.addEventListener('resize',update);
 const overlayObserver=new MutationObserver(update);overlayObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','open']});
 void start();return ()=>{disposed=true;host.removeAttribute('aria-label');cancelAnimationFrame(frame);observer.disconnect();overlayObserver.disconnect();window.removeEventListener('resize',update);remove();void api.nativePreviewStop(token).catch(()=>{});};
}
