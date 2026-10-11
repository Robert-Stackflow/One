import './base64.css';
import {api,q,toast,errorMessage} from './ui';
import {maxBase64FileBytes} from '../shared/base64';

type Mode='encode-text'|'decode-text'|'encode-file'|'decode-file';
export function base64Page(){return `<div class="base64-page"><header class="base64-heading"><h2>Base64</h2><p>在本机编码或解码文本与文件。</p></header>
 <section class="settings-card base64-settings" aria-label="Base64 设置"><h3>处理设置</h3><div class="base64-toolbar"><label for="base64-mode">操作</label><select id="base64-mode"><option value="encode-text">文本编码</option><option value="decode-text">文本解码</option><option value="encode-file">文件编码</option><option value="decode-file">Base64 导出文件</option></select><input id="base64-file" type="file" hidden><button id="base64-choose" type="button" hidden>选择文件</button><span id="base64-file-name"></span></div>
 <p id="base64-help">按 UTF-8 编码文本，支持中文与表情符号。所有内容仅在本机处理。</p>
 <div class="base64-actions"><button id="base64-run" type="button">编码</button><button id="base64-cancel" type="button" hidden>取消</button><button id="base64-copy" type="button" disabled>复制结果</button><button id="base64-export" type="button" disabled>导出文本</button></div><span id="base64-status" role="status" aria-live="polite"></span></section>
 <div class="base64-columns"><section class="settings-card base64-panel"><label for="base64-input">输入</label><textarea id="base64-input" spellcheck="false" placeholder="输入文本"></textarea></section><section class="settings-card base64-panel"><label for="base64-output">结果</label><textarea id="base64-output" spellcheck="false" readonly></textarea></section></div></div>`;}

export function setupBase64(){
 const mode=q<HTMLSelectElement>('base64-mode'),file=q<HTMLInputElement>('base64-file'),choose=q<HTMLButtonElement>('base64-choose'),name=q<HTMLElement>('base64-file-name');
 const input=q<HTMLTextAreaElement>('base64-input'),output=q<HTMLTextAreaElement>('base64-output'),help=q<HTMLElement>('base64-help'),run=q<HTMLButtonElement>('base64-run'),cancel=q<HTMLButtonElement>('base64-cancel'),copy=q<HTMLButtonElement>('base64-copy'),save=q<HTMLButtonElement>('base64-export'),status=q<HTMLElement>('base64-status');
 let worker:Worker|undefined,revision=0;
 const stop=()=>{worker?.terminate();worker=undefined;cancel.hidden=true;run.disabled=false;};
 const update=()=>{stop();revision++;const selected=mode.value as Mode;choose.hidden=selected!=='encode-file';input.parentElement!.hidden=selected==='encode-file';output.parentElement!.hidden=selected==='decode-file';run.textContent=selected==='encode-text'?'编码':selected==='decode-text'?'解码':selected==='encode-file'?'编码文件':'解码并保存';help.textContent=selected==='encode-file'?'选择最大 6 MB 的文件，编码结果可复制或导出文本。':selected==='decode-file'?'粘贴 Base64 并选择保存位置，解码后的原始字节不会被当作文本处理。':selected==='decode-text'?'按 UTF-8 解码 Base64；无效编码或非 UTF-8 字节会提示错误。':'按 UTF-8 编码文本，支持中文与表情符号。所有内容仅在本机处理。';output.value='';copy.disabled=save.disabled=true;status.textContent='';name.textContent=selected==='encode-file'&&file.files?.length?file.files[0].name:'';};
 const perform=async()=>{
  stop();const selected=mode.value as Mode,current=++revision;
  output.value='';copy.disabled=save.disabled=true;status.textContent='正在处理…';
  if(selected==='decode-file'){
   try{const path=await api.base64ExportFile(input.value);if(current===revision)status.textContent=path?'已保存文件':'已取消保存';}catch(error){if(current===revision){status.textContent=errorMessage(error);toast(error);}}return;
  }
  const chosen=file.files?.[0];if(selected==='encode-file'&&!chosen){status.textContent='请先选择文件';return;}
  if(selected==='encode-file'&&chosen!.size>maxBase64FileBytes){status.textContent='文件不能超过 6 MB';return;}
  if(selected!=='encode-file'&&input.value.length>2*1024*1024){status.textContent='文本不能超过 2 MB';return;}
  let buffer:ArrayBuffer|undefined;
  if(selected==='encode-file'){try{buffer=await chosen!.arrayBuffer();}catch(error){status.textContent=errorMessage(error);return;}if(current!==revision)return;}
  run.disabled=true;cancel.hidden=false;
  const task=new Worker(new URL('./base64-worker.ts',import.meta.url),{type:'module'});worker=task;
  task.onmessage=(event:MessageEvent<{id:number;result?:string;error?:string}>)=>{if(current!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}output.value=event.data.result||'';copy.disabled=save.disabled=!output.value;status.textContent=selected==='encode-file'?`已编码 ${chosen!.name}`:selected==='decode-text'?'已解码':'已编码';};
  task.onerror=()=>{if(current!==revision)return;stop();status.textContent='处理失败，请重试';};
  if(buffer)task.postMessage({id:current,action:selected,buffer},[buffer]);else task.postMessage({id:current,action:selected,text:input.value});
 };
 mode.onchange=update;choose.onclick=()=>file.click();file.onchange=()=>{name.textContent=file.files?.[0]?.name||'';};run.onclick=()=>void perform();cancel.onclick=()=>{revision++;stop();status.textContent='已取消';};
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制结果')).catch(toast);
 save.onclick=()=>void api.saveText(output.value,'utf-8').then(path=>{if(path)status.textContent='已导出文本';}).catch(toast);
 update();return {activate(value:boolean){if(!value&&worker){revision++;stop();status.textContent='已取消';}},dispose(){revision++;stop();}};
}
