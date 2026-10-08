import {dialogMarkup,openDialog,closeDialog} from './dialog';
import './color.css';
import './hud.css';
import {api,q,icon,button,toast,errorMessage,iconButton,switchControl} from './ui';
import {ColorPalette} from './color-palette';
import {colorFormats,colorFormatNames,type ColorFormat} from '../shared/colors';
import type {ScreenCapture} from '../shared/types';
import {bindPreference} from './preferences';
import {setupShortcut} from './shortcut';
export {colorFormats} from '../shared/colors';
export function colorPage(){return `<div id="color-actions" class="color-header-actions">${button('open-color-editor','颜色面板','appearance')}<div class="color-ruler-split"><button id="start-screen-ruler" type="button" title="在实时画面上测量">${icon('ruler')}<span>屏幕尺</span></button><button id="screen-ruler-options" type="button" aria-label="选择屏幕尺模式" aria-haspopup="menu" aria-expanded="false">${icon('chevron-down')}</button><div id="screen-ruler-menu" class="color-ruler-menu" role="menu" hidden><button type="button" role="menuitemradio" aria-checked="true" data-ruler-mode="live"><span>实时画面</span><small>测量时保持原窗口活跃</small></button><button type="button" role="menuitemradio" aria-checked="false" data-ruler-mode="static"><span>静态画面</span><small>聚焦屏幕尺测量</small></button></div></div><div class="color-pick-split"><button id="start-color" type="button" title="在实时画面上取色">${icon('color')}<span>开始取色</span></button><button id="color-pick-options" type="button" aria-label="选择取色模式" aria-haspopup="menu" aria-expanded="false">${icon('chevron-down')}</button><div id="color-pick-menu" class="color-ruler-menu" role="menu" hidden><button type="button" role="menuitemradio" aria-checked="true" data-color-mode="live"><span>实时画面</span><small>移动鼠标取色，按 Space 可冻结</small></button><button type="button" role="menuitemradio" aria-checked="false" data-color-mode="frozen"><span>冻结画面</span><small>固定当前画面后取色</small></button></div></div></div><div class="color-page">
  <div class="color-workbench" id="color-workbench">
    <aside class="color-overview" aria-label="当前颜色与历史">
      <div class="color-sample" id="color-sample" data-color-sample><span id="color-sample-code" data-color-label></span></div>
      <div class="color-edit-row"><input id="color-edit" data-color-input aria-label="编辑颜色" value="#4479D8" maxlength="7" spellcheck="false"><button id="color-add" class="icon-button quiet" data-color-save aria-label="保存并复制颜色" title="保存并复制颜色">${icon('check')}</button></div>
      <div class="color-main-variants"><span>相近色</span><div class="color-variant-list" data-color-variants></div></div>
      <section data-color-recent class="color-recent" id="color-recent" aria-label="最近颜色" hidden><div class="color-history-head"><h2>最近颜色</h2><button id="clear-color-history" class="icon-button quiet" data-color-clear aria-label="清空最近颜色" title="清空最近颜色">${icon('trash')}</button></div><div class="color-history" id="color-history" data-color-history></div></section>
    </aside>
    <section class="color-formats" aria-label="颜色值"><div class="color-values-heading"><h2>颜色值</h2>${button('color-format-edit','显示格式','system')}</div><div class="color-values" id="color-values" data-color-values></div></section>
  </div>
  <section class="color-settings" aria-label="取色设置"><div class="preference-row color-shortcut-row"><label for="color-shortcut">取色快捷键</label><div class="color-shortcut-field"><input id="color-shortcut" aria-label="取色快捷键"></div></div><div class="preference-row"><label for="color-default-format">默认复制格式</label><select id="color-default-format" aria-label="默认复制格式">${Object.entries(colorFormatNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></div><div class="preference-row"><label for="color-wheel-zoom">滚轮局部放大</label>${switchControl('color-wheel-zoom','滚轮局部放大')}</div><div class="preference-row"><label for="color-show-editor">取色后打开颜色面板</label>${switchControl('color-show-editor','取色后打开颜色面板')}</div></section>
</div>${dialogMarkup({id:"color-formats-dialog",title:"显示格式",closeId:"color-formats-close",body:`<div class="format-options">${Object.entries(colorFormatNames).map(([id,name])=>`<label><input type="checkbox" data-format="${id}"><span>${name}</span></label>`).join('')}</div>`})}`;}
export function setupColorPage(){
 const palette=new ColorPalette(q('color-workbench'));let visible:ColorFormat[]=[];
 let shortcutControl:ReturnType<typeof setupShortcut>;
 const showShortcutStatus=(status:{active:boolean;error:string})=>shortcutControl.setStatus(status);
 const shortcutError=(error:unknown)=>{const message=errorMessage(error);if(message.includes('快捷键已被占用'))showShortcutStatus({active:false,error:message});else toast(error);};
 shortcutControl=setupShortcut(q<HTMLInputElement>('color-shortcut'),shortcutError,{onRetry:()=>void api.retryColorShortcut().then(showShortcutStatus).catch(toast)});
 const load=async()=>{const [s,status]=await Promise.all([api.settings(),api.colorShortcutStatus()]);visible=s.colorVisibleFormats;q<HTMLInputElement>('color-shortcut').value=s.colorShortcut;q<HTMLSelectElement>('color-default-format').value=s.colorFormat;q<HTMLInputElement>('color-wheel-zoom').checked=s.colorWheelZoom;q<HTMLInputElement>('color-show-editor').checked=s.colorShowEditor;showShortcutStatus(status);};
 void load().catch(toast);api.onColorSettings(()=>void load().catch(toast));api.onColorShortcutStatus(showShortcutStatus);
 let colorMode:'live'|'frozen'='live';const colorMenu=q<HTMLElement>('color-pick-menu'),colorOptions=q<HTMLButtonElement>('color-pick-options'),colorSplit=colorOptions.parentElement!;let colorMenuEvents:AbortController|undefined;
 const closeColorMenu=()=>{colorMenuEvents?.abort();colorMenuEvents=undefined;colorMenu.hidden=true;colorOptions.setAttribute('aria-expanded','false');};
 const startColor=(mode:'live'|'frozen')=>{colorMode=mode;q('start-color').setAttribute('title',mode==='live'?'在实时画面上取色':'冻结当前画面后取色');colorMenu.querySelectorAll<HTMLElement>('[data-color-mode]').forEach(item=>item.setAttribute('aria-checked',String(item.dataset.colorMode===mode)));closeColorMenu();void api.pickColor(mode).catch(toast);};
 q('start-color').onclick=()=>startColor(colorMode);
 colorOptions.onclick=()=>{if(!colorMenu.hidden){closeColorMenu();return;}colorMenu.hidden=false;colorOptions.setAttribute('aria-expanded','true');colorMenuEvents=new AbortController();document.addEventListener('pointerdown',event=>{if(!colorSplit.contains(event.target as Node))closeColorMenu();},{signal:colorMenuEvents.signal});document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeColorMenu();colorOptions.focus();}},{signal:colorMenuEvents.signal});};
 colorMenu.querySelectorAll<HTMLButtonElement>('[data-color-mode]').forEach(item=>item.onclick=()=>startColor(item.dataset.colorMode as 'live'|'frozen'));
 let rulerMode:'live'|'static'='live';const rulerMenu=q<HTMLElement>('screen-ruler-menu'),rulerOptions=q<HTMLButtonElement>('screen-ruler-options'),rulerSplit=rulerOptions.parentElement!;let rulerMenuEvents:AbortController|undefined;
 const closeRulerMenu=()=>{rulerMenuEvents?.abort();rulerMenuEvents=undefined;rulerMenu.hidden=true;rulerOptions.setAttribute('aria-expanded','false');};
 const startRuler=(mode:'live'|'static')=>{rulerMode=mode;q('start-screen-ruler').setAttribute('title',mode==='live'?'在实时画面上测量':'在静态画面上测量');rulerMenu.querySelectorAll<HTMLElement>('[data-ruler-mode]').forEach(item=>item.setAttribute('aria-checked',String(item.dataset.rulerMode===mode)));closeRulerMenu();void api.openScreenRuler(mode).catch(toast);};
 q('start-screen-ruler').onclick=()=>startRuler(rulerMode);
 rulerOptions.onclick=()=>{if(!rulerMenu.hidden){closeRulerMenu();return;}rulerMenu.hidden=false;rulerOptions.setAttribute('aria-expanded','true');rulerMenuEvents=new AbortController();document.addEventListener('pointerdown',event=>{if(!rulerSplit.contains(event.target as Node))closeRulerMenu();},{signal:rulerMenuEvents.signal});document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeRulerMenu();rulerOptions.focus();}},{signal:rulerMenuEvents.signal});};
 rulerMenu.querySelectorAll<HTMLButtonElement>('[data-ruler-mode]').forEach(item=>item.onclick=()=>startRuler(item.dataset.rulerMode as 'live'|'static'));
 q('open-color-editor').onclick=()=>void api.showColorEditor(palette.selected).catch(toast);
 q('color-shortcut').addEventListener('change',()=>{const value=q<HTMLInputElement>('color-shortcut').value;void api.patchSettings({colorShortcut:value}).then(()=>void load().catch(toast)).catch(shortcutError);});
 bindPreference(q('color-default-format'),()=>({colorFormat:q<HTMLSelectElement>('color-default-format').value as ColorFormat}),load);
 bindPreference(q('color-wheel-zoom'),()=>({colorWheelZoom:q<HTMLInputElement>('color-wheel-zoom').checked}),load);
 bindPreference(q('color-show-editor'),()=>({colorShowEditor:q<HTMLInputElement>('color-show-editor').checked}),load);
 const dialog=q<HTMLDialogElement>('color-formats-dialog');q('color-format-edit').onclick=()=>{dialog.querySelectorAll<HTMLInputElement>('[data-format]').forEach(i=>i.checked=visible.includes(i.dataset.format as ColorFormat));openDialog(dialog);};q('color-formats-close').onclick=()=>closeDialog(dialog);dialog.onchange=()=>{visible=[...dialog.querySelectorAll<HTMLInputElement>('[data-format]:checked')].map(i=>i.dataset.format as ColorFormat);void api.patchSettings({colorVisibleFormats:visible}).catch(toast);};
}
export async function renderColorPicker(){
  document.documentElement.classList.add('transparent-root');document.body.className='color-picker-window';
  q('app').innerHTML='<div class="live-loupe"><div class="loupe-preview"><canvas id="loupe-canvas" width="180" height="180"></canvas><span id="loupe-zoom-hint" class="loupe-zoom-hint">滚轮局部放大</span></div><div class="loupe-value"><i id="loupe-swatch" class="loupe-swatch"></i><strong id="loupe-value">…</strong><small>HEX</small></div><div class="loupe-hint"><span>单击复制</span><span id="loupe-freeze-hint">Space 冻结</span><span><kbd>Esc</kbd> 取消</span></div></div>';
  const zoomHint=q<HTMLElement>('loupe-zoom-hint');zoomHint.hidden=new URLSearchParams(location.search).get('wheelZoom')!=='1';
  api.onColorSettings(()=>void api.settings().then(settings=>{zoomHint.hidden=!settings.colorWheelZoom;}).catch(()=>{}));
  const setFrozen=(frozen:boolean)=>{q('loupe-freeze-hint').textContent=frozen?'Space 恢复':'Space 冻结';};api.onColorFrozen(setFrozen);void api.colorFrozenStatus().then(setFrozen).catch(()=>{});
  const canvas=q<HTMLCanvasElement>('loupe-canvas'),ctx=canvas.getContext('2d')!,source=document.createElement('canvas'),src=source.getContext('2d')!;let pending:ScreenCapture|undefined,frame=0;
  const paint=()=>{frame=0;const sample=pending;if(!sample?.data)return;source.width=sample.width;source.height=sample.height;const data=new Uint8ClampedArray(sample.data);for(let i=0;i<data.length;i+=4){const b=data[i];data[i]=data[i+2];data[i+2]=b;}src.putImageData(new ImageData(data,sample.width,sample.height),0,0);ctx.imageSmoothingEnabled=false;
    const left=sample.zoomFrozen?(sample.cropX??0):(sample.centerX??Math.floor(sample.width/2))-Math.floor(sample.pixels/2),top=sample.zoomFrozen?(sample.cropY??0):(sample.centerY??Math.floor(sample.height/2))-Math.floor(sample.pixels/2),right=Math.min(sample.width,left+sample.pixels),bottom=Math.min(sample.height,top+sample.pixels),sx=Math.max(0,left),sy=Math.max(0,top),unit=180/sample.pixels;
    ctx.fillStyle='#141414';ctx.fillRect(0,0,180,180);if(right>sx&&bottom>sy)ctx.drawImage(source,sx,sy,right-sx,bottom-sy,(sx-left)*unit,(sy-top)*unit,(right-sx)*unit,(bottom-sy)*unit);
    const cell=unit,markerX=sample.zoomFrozen?((sample.centerX??Math.floor(sample.width/2))-left)*unit:(180-cell)/2,markerY=sample.zoomFrozen?((sample.centerY??Math.floor(sample.height/2))-top)*unit:(180-cell)/2;ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeRect(markerX,markerY,cell,cell);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(markerX,markerY,cell,cell);q('loupe-value').textContent=sample.hex;q('loupe-swatch').style.background=sample.hex;q('loupe-zoom-hint').textContent=sample.zoomFrozen?'局部放大 · 滚轮缩小恢复':'滚轮局部放大';void api.colorFrame().catch(()=>{});};
  const update=(sample:ScreenCapture)=>{pending=sample;if(!frame)frame=requestAnimationFrame(paint);};api.onColorSample(update);const initial=await api.colorCapture();if(initial)update(initial);
}
