import {dialogMarkup,openDialog,closeDialog} from './dialog';
import {api,q,icon,button,toast,iconButton,switchControl} from './ui';
import {ColorPalette} from './color-palette';
import {colorFormats,colorFormatNames,type ColorFormat} from '../shared/colors';
import type {ScreenCapture} from '../shared/types';
import {bindPreference} from './preferences';
import {setupShortcut} from './shortcut';
export {colorFormats} from '../shared/colors';
export function colorPage(){return `<div id="color-actions" class="color-header-actions">${button('open-color-editor','颜色面板','appearance')}${button('start-color','开始取色','color',true)}</div><div class="color-page">
  <div class="color-workbench" id="color-workbench">
    <aside class="color-overview" aria-label="当前颜色与历史">
      <div class="color-sample" id="color-sample" data-color-sample><span id="color-sample-code" data-color-label></span></div>
      <div class="color-edit-row"><input id="color-edit" data-color-input aria-label="编辑颜色" value="#4479D8" maxlength="7" spellcheck="false"><button id="color-add" class="icon-button quiet" data-color-save aria-label="保存并复制颜色" title="保存并复制颜色">${icon('check')}</button></div>
      <div class="color-main-variants"><span>相近色</span><div class="color-variant-list" data-color-variants></div></div>
      <section data-color-recent class="color-recent" id="color-recent" aria-label="最近颜色" hidden><div class="color-history-head"><h2>最近颜色</h2><button id="clear-color-history" class="icon-button quiet" data-color-clear aria-label="清空最近颜色" title="清空最近颜色">${icon('trash')}</button></div><div class="color-history" id="color-history" data-color-history></div></section>
    </aside>
    <section class="color-formats" aria-label="颜色值"><div class="color-values-heading"><h2>颜色值</h2>${button('color-format-edit','显示格式','system')}</div><div class="color-values" id="color-values" data-color-values></div></section>
  </div>
  <section class="color-settings" aria-label="取色设置"><div class="preference-row"><label for="color-shortcut">取色快捷键</label><input id="color-shortcut" aria-label="取色快捷键"></div><div class="preference-row"><label for="color-default-format">默认复制格式</label><select id="color-default-format" aria-label="默认复制格式">${Object.entries(colorFormatNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></div><div class="preference-row"><label for="color-show-editor">取色后打开颜色面板</label>${switchControl('color-show-editor','取色后打开颜色面板')}</div></section>
</div>${dialogMarkup({id:"color-formats-dialog",title:"显示格式",closeId:"color-formats-close",body:`<div class="format-options">${Object.entries(colorFormatNames).map(([id,name])=>`<label><input type="checkbox" data-format="${id}"><span>${name}</span></label>`).join('')}</div>`})}`;}
export function setupColorPage(){
 const palette=new ColorPalette(q('color-workbench'));let visible:ColorFormat[]=[];
 setupShortcut(q<HTMLInputElement>('color-shortcut'));
 const load=async()=>{const s=await api.settings();visible=s.colorVisibleFormats;q<HTMLInputElement>('color-shortcut').value=s.colorShortcut;q<HTMLSelectElement>('color-default-format').value=s.colorFormat;q<HTMLInputElement>('color-show-editor').checked=s.colorShowEditor;};
 void load().catch(toast);api.onColorSettings(()=>void load().catch(toast));
 q('start-color').onclick=()=>void api.pickColor().catch(toast);q('open-color-editor').onclick=()=>void api.showColorEditor(palette.selected).catch(toast);
 bindPreference(q('color-shortcut'),()=>({colorShortcut:q<HTMLInputElement>('color-shortcut').value}),load);
 bindPreference(q('color-default-format'),()=>({colorFormat:q<HTMLSelectElement>('color-default-format').value as ColorFormat}),load);
 bindPreference(q('color-show-editor'),()=>({colorShowEditor:q<HTMLInputElement>('color-show-editor').checked}),load);
 const dialog=q<HTMLDialogElement>('color-formats-dialog');q('color-format-edit').onclick=()=>{dialog.querySelectorAll<HTMLInputElement>('[data-format]').forEach(i=>i.checked=visible.includes(i.dataset.format as ColorFormat));openDialog(dialog);};q('color-formats-close').onclick=()=>closeDialog(dialog);dialog.onchange=()=>{visible=[...dialog.querySelectorAll<HTMLInputElement>('[data-format]:checked')].map(i=>i.dataset.format as ColorFormat);void api.patchSettings({colorVisibleFormats:visible}).catch(toast);};
}
export async function renderColorPicker(){
  document.documentElement.classList.add('transparent-root');document.body.className='color-picker-window';
  q('app').innerHTML='<div class="live-loupe"><div class="loupe-preview"><canvas id="loupe-canvas" width="180" height="180"></canvas></div><div class="loupe-value"><i id="loupe-swatch" class="loupe-swatch"></i><strong id="loupe-value">…</strong><small>HEX</small></div><div class="loupe-hint"><span>单击复制</span><span><kbd>Esc</kbd> 取消</span></div></div>';
  const canvas=q<HTMLCanvasElement>('loupe-canvas'),ctx=canvas.getContext('2d')!,source=document.createElement('canvas'),src=source.getContext('2d')!;let pending:ScreenCapture|undefined,frame=0;
  const paint=()=>{frame=0;const sample=pending;if(!sample?.data)return;source.width=sample.width;source.height=sample.height;const data=new Uint8ClampedArray(sample.data);for(let i=0;i<data.length;i+=4){const b=data[i];data[i]=data[i+2];data[i+2]=b;}src.putImageData(new ImageData(data,sample.width,sample.height),0,0);ctx.imageSmoothingEnabled=false;const offset=(sample.width-sample.pixels)/2;ctx.drawImage(source,offset,offset,sample.pixels,sample.pixels,0,0,180,180);const cell=180/sample.pixels,center=(180-cell)/2;ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeRect(center,center,cell,cell);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(center,center,cell,cell);q('loupe-value').textContent=sample.hex;q('loupe-swatch').style.background=sample.hex;void api.colorFrame().catch(()=>{});};
  const update=(sample:ScreenCapture)=>{pending=sample;if(!frame)frame=requestAnimationFrame(paint);};api.onColorSample(update);const initial=await api.colorCapture();if(initial)update(initial);
}
