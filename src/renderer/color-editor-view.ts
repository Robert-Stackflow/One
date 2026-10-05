import {api,q,icon,iconButton,action} from './ui';
import './color.css';
import {ColorPalette} from './color-palette';
export function renderColorEditor(){
 document.body.className='color-editor-window native-frame custom-window-frame';
 q('app').innerHTML=`<section class="color-editor-shell" id="color-editor-palette" aria-label="颜色面板"><header class="color-editor-heading drag-region">${iconButton('color-editor-pick','重新取色','color')}<h1>取色结果</h1>${iconButton('color-editor-close','关闭','close')}</header><div class="color-editor-scroll"><div class="color-editor-content" id="color-editor-content">
 <section data-color-recent class="color-editor-recent" aria-label="最近颜色" hidden><div data-color-history class="color-history"></div><button class="icon-button quiet" data-color-clear title="清空最近颜色" aria-label="清空最近颜色">${icon('trash')}</button></section>
 <div class="color-editor-current"><div class="color-editor-sample" data-color-sample aria-label="当前颜色"></div><div class="color-editor-edit"><input id="color-editor-hex" data-color-input value="#4479D8" aria-label="编辑 HEX 颜色" maxlength="7" spellcheck="false"><button class="icon-button quiet" data-color-save aria-label="保存并复制颜色" title="保存并复制颜色">${icon('check')}</button></div></div>
 <section class="color-editor-variants" aria-label="相近色"><div data-color-variants class="color-variant-list"></div></section>
 <section class="color-editor-formats" aria-label="颜色值"><div class="color-values" data-color-values></div><button data-color-more class="color-editor-more" aria-expanded="false" hidden></button></section>
 </div></div></section><div id="toast" class="toast" role="status" hidden></div>`;
 const palette=new ColorPalette(q('color-editor-palette'),true);api.onColorEditorOpen(hex=>palette.select(hex));
 action('color-editor-close',()=>api.closeWindow());action('color-editor-pick',()=>api.pickColor());
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&!document.querySelector('dialog[open]')){event.preventDefault();void api.closeWindow();}});
 let frame=0,last=0;const size=()=>{frame=0;const height=Math.ceil(q('color-editor-content').getBoundingClientRect().height+document.querySelector('.color-editor-heading')!.getBoundingClientRect().height);if(height!==last){last=height;void api.colorEditorSize(Math.max(200,height));}};
 new ResizeObserver(()=>{if(!frame)frame=requestAnimationFrame(size);}).observe(q('color-editor-content'));
}
