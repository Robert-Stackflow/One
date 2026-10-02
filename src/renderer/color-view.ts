import {dialogMarkup,openDialog,closeDialog} from './dialog';
import {api,q,esc,icon,button,toast,iconButton} from './ui';
import {colorFormats,colorFormatNames,type ColorFormat} from '../shared/colors';
import type {ScreenCapture} from '../shared/types';
import {bindPreference} from './preferences';
import {setupShortcut} from './shortcut';
export {colorFormats} from '../shared/colors';
export function colorPage(){return `<div id="color-actions" class="color-header-actions">${button('start-color','开始取色','color',true)}</div><div class="color-page">
  <div class="color-workbench">
    <aside class="color-overview" aria-label="当前颜色与历史">
      <div class="color-sample" id="color-sample"><span id="color-sample-code"></span></div>
      <div class="color-edit-row"><input id="color-edit" aria-label="编辑颜色" value="#4479D8" maxlength="7" spellcheck="false">${iconButton('color-add','加入最近颜色','plus')}</div>
      <section class="color-recent" id="color-recent" aria-label="最近颜色" hidden><div class="color-history-head"><h2>最近颜色</h2>${iconButton('clear-color-history','清空最近颜色','trash')}</div><div class="color-history" id="color-history"></div></section>
    </aside>
    <section class="color-formats" aria-label="颜色值"><div class="color-values-heading"><h2>颜色值</h2>${button('color-format-edit','显示格式','system')}</div><div class="color-values" id="color-values"></div></section>
  </div>
  <section class="color-settings" aria-label="取色设置"><div class="preference-row"><label for="color-shortcut">取色快捷键</label><input id="color-shortcut" aria-label="取色快捷键"></div><div class="preference-row"><label for="color-default-format">默认复制格式</label><select id="color-default-format" aria-label="默认复制格式">${Object.entries(colorFormatNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></div></section>
</div>${dialogMarkup({id:"color-formats-dialog",title:"显示格式",closeId:"color-formats-close",body:`<div class="format-options">${Object.entries(colorFormatNames).map(([id,name])=>`<label><input type="checkbox" data-format="${id}"><span>${name}</span></label>`).join('')}</div>`})}`;}
export function setupColorPage(){
  let selected='#4479D8',visible:ColorFormat[]=['hex','rgb','hsl','hsv','oklch','cmyk'];
  setupShortcut(q<HTMLInputElement>('color-shortcut'));
  const select=(hex:string)=>{selected=hex.toUpperCase();const values=colorFormats(selected);q('color-sample').style.background=selected;const [r,g,b]=hex.slice(1).match(/../g)!.map(x=>parseInt(x,16));q('color-sample-code').style.color=r*.299+g*.587+b*.114>155?'#202020':'#fff';q('color-sample-code').textContent=selected;q<HTMLInputElement>('color-edit').value=selected;q('color-history').querySelectorAll<HTMLElement>('[data-hex]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.hex!.toUpperCase()===selected)));q('color-values').innerHTML=visible.map(kind=>`<button data-copy="${esc(values[kind])}" aria-label="复制 ${colorFormatNames[kind]}"><span>${colorFormatNames[kind]}</span><strong>${esc(values[kind])}</strong>${icon('copy')}</button>`).join('');q('color-values').querySelectorAll<HTMLElement>('[data-copy]').forEach(b=>b.onclick=()=>void api.copyText(b.dataset.copy!).then(()=>toast('已复制')));};
  const load=async(latest=false)=>{const s=await api.settings();visible=s.colorVisibleFormats;q<HTMLInputElement>('color-shortcut').value=s.colorShortcut;q<HTMLSelectElement>('color-default-format').value=s.colorFormat;q('color-history').innerHTML=s.colorHistory.map(hex=>`<button style="--swatch:${hex}" data-hex="${hex}" aria-label="${hex}" title="${hex}" aria-pressed="false"><i></i><span>${hex}</span></button>`).join('');q('color-recent').hidden=!s.colorHistory.length;q('color-history').querySelectorAll<HTMLElement>('[data-hex]').forEach(b=>b.onclick=()=>select(b.dataset.hex!));select(latest?s.colorHistory[0]||selected:selected);};
  select(selected);void load(true).catch(toast);api.onColor(()=>void load(true).catch(toast));q('start-color').onclick=()=>void api.pickColor().catch(toast);
  q('color-edit').addEventListener('input',()=>{const hex=q<HTMLInputElement>('color-edit').value;if(/^#[\da-f]{6}$/i.test(hex))select(hex);});q('color-edit').addEventListener('keydown',event=>{if(event.key==='Enter')q('color-add').click();});
  q('color-add').onclick=()=>{const hex=q<HTMLInputElement>('color-edit').value;if(!/^#[\da-f]{6}$/i.test(hex))return toast('请输入 #RRGGBB 格式颜色');void api.chooseColor(hex).catch(toast);};
  bindPreference(q('color-shortcut'),()=>({colorShortcut:q<HTMLInputElement>('color-shortcut').value}),()=>load());
  bindPreference(q('color-default-format'),()=>({colorFormat:q<HTMLSelectElement>('color-default-format').value as ColorFormat}),()=>load());
  q('clear-color-history').onclick=()=>void api.patchSettings({colorHistory:[]}).then(()=>load()).catch(toast);
  const dialog=q<HTMLDialogElement>('color-formats-dialog');q('color-format-edit').onclick=()=>{dialog.querySelectorAll<HTMLInputElement>('[data-format]').forEach(i=>i.checked=visible.includes(i.dataset.format as ColorFormat));openDialog(dialog);};q('color-formats-close').onclick=()=>closeDialog(dialog);dialog.onchange=()=>{visible=[...dialog.querySelectorAll<HTMLInputElement>('[data-format]:checked')].map(i=>i.dataset.format as ColorFormat);void api.patchSettings({colorVisibleFormats:visible}).then(()=>{select(selected);}).catch(toast);};
}
export async function renderColorPicker(){
  document.documentElement.classList.add('transparent-root');document.body.className='color-picker-window';
  q('app').innerHTML='<div class="live-loupe"><div class="loupe-preview"><canvas id="loupe-canvas" width="180" height="180"></canvas></div><div class="loupe-value"><i id="loupe-swatch" class="loupe-swatch"></i><strong id="loupe-value">…</strong><small>HEX</small></div><div class="loupe-hint"><span>单击复制</span><span><kbd>Esc</kbd> 取消</span></div></div>';
  const canvas=q<HTMLCanvasElement>('loupe-canvas'),ctx=canvas.getContext('2d')!,source=document.createElement('canvas'),src=source.getContext('2d')!;let pending:ScreenCapture|undefined,frame=0;
  const paint=()=>{frame=0;const sample=pending;if(!sample?.data)return;source.width=sample.width;source.height=sample.height;const data=new Uint8ClampedArray(sample.data);for(let i=0;i<data.length;i+=4){const b=data[i];data[i]=data[i+2];data[i+2]=b;}src.putImageData(new ImageData(data,sample.width,sample.height),0,0);ctx.imageSmoothingEnabled=false;const offset=(sample.width-sample.pixels)/2;ctx.drawImage(source,offset,offset,sample.pixels,sample.pixels,0,0,180,180);const cell=180/sample.pixels,center=(180-cell)/2;ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeRect(center,center,cell,cell);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(center,center,cell,cell);q('loupe-value').textContent=sample.hex;q('loupe-swatch').style.background=sample.hex;void api.colorFrame().catch(()=>{});};
  const update=(sample:ScreenCapture)=>{pending=sample;if(!frame)frame=requestAnimationFrame(paint);};api.onColorSample(update);const initial=await api.colorCapture();if(initial)update(initial);
}
