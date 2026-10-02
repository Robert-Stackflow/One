import {api,q,action} from './ui';
export const windowControls=(prefix='window')=>`<div class="window-controls ${prefix==='preview'?'preview-window-controls':''}"><button id="${prefix}-minimize" aria-label="最小化" title="最小化"><svg class="window-glyph" viewBox="0 0 16 16"><path d="M3 8h10"/></svg></button><button id="${prefix}-maximize" aria-label="最大化" title="最大化"><svg class="window-glyph" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9"/></svg></button><button id="${prefix}-close" aria-label="关闭" title="关闭"><svg class="window-glyph" viewBox="0 0 16 16"><path d="m3.5 3.5 9 9m0-9-9 9"/></svg></button></div>`;
export function setupChrome(prefix='window'){
  document.body.classList.add('native-frame','custom-window-frame');
  for(const [name,kind] of [['minimize','minimize'],['maximize','maximize'],['close','close']] as const)action(prefix+'-'+name,()=>api.windowAction(kind));
  let previous:boolean|undefined;
  const update=({maximized}:{maximized:boolean})=>{if(previous===maximized)return;previous=maximized;document.body.classList.toggle('maximized',maximized);const b=q(prefix+'-maximize');b.title=maximized?'还原':'最大化';b.setAttribute('aria-label',b.title);b.innerHTML=maximized?'<svg class="window-glyph" viewBox="0 0 16 16"><path d="M5.5 5.5v-2h7v7h-2"/><rect x="3.5" y="5.5" width="7" height="7"/></svg>':'<svg class="window-glyph" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9"/></svg>';};
  api.onWindowState(update);void api.windowState().then(update).catch(()=>{});
}
