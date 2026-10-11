import './base64.css';
import {api,q,toast,errorMessage} from './ui';
import {maxBase64FileBytes} from '../shared/base64';
import type {BinaryCodec,TextCodec} from '../shared/text-codecs';
import {installFileDropOverlay} from './file-drop-overlay';

type Mode='encode-text'|'decode-text'|'encode-file'|'decode-file';
const codecs:[TextCodec,string][]=[['base64','Base64'],['base64url','Base64URL'],['hex','十六进制'],['base32','Base32'],['quoted-printable','Quoted-Printable'],['html','HTML 实体'],['unicode','Unicode 转义']];
type Encoding={result?:string;error?:string};

export function base64Page(){return `<div class="base64-page">
 <section class="settings-card base64-settings" aria-label="编解码设置"><div class="base64-toolbar"><label for="base64-mode">操作</label><select id="base64-mode"><option value="encode-text">文本编码</option><option value="decode-text">文本解码</option><option value="encode-file">文件编码</option><option value="decode-file">解码并保存文件</option></select><label id="base64-file-codec-field" for="base64-file-codec" hidden>编码类型</label><select id="base64-file-codec" hidden><option value="base64">Base64</option><option value="base64url">Base64URL</option><option value="hex">十六进制</option><option value="base32">Base32</option></select><input id="base64-file" type="file" hidden><button id="base64-choose" type="button" hidden>选择文件</button><span id="base64-file-name"></span></div>
 <div class="base64-actions"><button id="base64-run" type="button" hidden>处理文件</button><button id="base64-cancel" type="button" hidden>取消</button></div><span id="base64-status" role="status" aria-live="polite"></span></section>
 <div class="base64-columns"><section class="settings-card base64-panel"><label for="base64-input">输入</label><textarea id="base64-input" spellcheck="false" placeholder="输入文本"></textarea></section><section class="settings-card base64-panel"><div class="base64-result-head"><label for="base64-output">结果</label><div><button id="base64-copy" type="button" disabled>复制结果</button><button id="base64-export" type="button" disabled>导出文本</button></div></div><div id="base64-codecs" class="base64-codecs" role="tablist" aria-label="编码类型">${codecs.map(([id,label],index)=>`<button type="button" role="tab" data-codec="${id}" aria-selected="${index===0}" aria-controls="base64-output">${label}</button>`).join('')}</div><textarea id="base64-output" spellcheck="false" readonly></textarea></section></div></div>`;}

export function setupBase64(){
 const mode=q<HTMLSelectElement>('base64-mode'),fileCodec=q<HTMLSelectElement>('base64-file-codec'),fileCodecField=q<HTMLElement>('base64-file-codec-field'),file=q<HTMLInputElement>('base64-file'),choose=q<HTMLButtonElement>('base64-choose'),name=q<HTMLElement>('base64-file-name'),tabs=q<HTMLElement>('base64-codecs');
 const input=q<HTMLTextAreaElement>('base64-input'),output=q<HTMLTextAreaElement>('base64-output'),run=q<HTMLButtonElement>('base64-run'),cancel=q<HTMLButtonElement>('base64-cancel'),copy=q<HTMLButtonElement>('base64-copy'),save=q<HTMLButtonElement>('base64-export'),status=q<HTMLElement>('base64-status');
 let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,revision=0,selected:TextCodec='base64',encodings:Partial<Record<TextCodec,Encoding>>={};
 const stop=()=>{if(timer)clearTimeout(timer);timer=undefined;worker?.terminate();worker=undefined;cancel.hidden=true;run.disabled=false;};
 const show=()=>{const value=encodings[selected];output.value=value?.result||'';copy.disabled=save.disabled=!output.value;if(value?.error)status.textContent=value.error;};
 const clear=()=>{output.value='';copy.disabled=save.disabled=true;status.textContent='';encodings={};};
 const executeText=()=>{const action=mode.value as Mode,id=revision;if(!input.value){clear();return;}if(input.value.length>2*1024*1024){status.textContent='文本不能超过 2 MB';return;}
  status.textContent='正在处理…';const task=new Worker(new URL('./base64-worker.ts',import.meta.url),{type:'module'});worker=task;
  task.onmessage=(event:MessageEvent<{id:number;result?:string;results?:Record<TextCodec,Encoding>;error?:string}>)=>{if(id!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}if(action==='encode-text'){encodings=event.data.results||{};show();if(!encodings[selected]?.error)status.textContent='已生成全部编码';}else{output.value=event.data.result||'';copy.disabled=save.disabled=!output.value;status.textContent='已解码';}};
  task.onerror=()=>{if(id!==revision)return;stop();status.textContent='处理失败，请重试';};
  task.postMessage({id,action:action==='encode-text'?'encode-all':'decode-text',text:input.value,codec:selected});
 };
 const schedule=(delay=150)=>{revision++;stop();clear();if(mode.value!=='encode-text'&&mode.value!=='decode-text')return;if(input.value)timer=setTimeout(executeText,delay);};
 const executeFile=async()=>{revision++;stop();const id=revision,chosen=file.files?.[0];clear();if(!chosen){status.textContent='请先选择文件';return;}if(chosen.size>maxBase64FileBytes){status.textContent='文件不能超过 6 MB';return;}status.textContent='正在读取文件…';
  let buffer:ArrayBuffer;try{buffer=await chosen.arrayBuffer();}catch(error){if(id===revision)status.textContent=errorMessage(error);return;}if(id!==revision)return;
  run.disabled=true;cancel.hidden=false;const task=new Worker(new URL('./base64-worker.ts',import.meta.url),{type:'module'});worker=task;
  task.onmessage=(event:MessageEvent<{id:number;result?:string;error?:string}>)=>{if(id!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}output.value=event.data.result||'';copy.disabled=save.disabled=!output.value;status.textContent=`已编码 ${chosen.name}`;};
  task.onerror=()=>{if(id!==revision)return;stop();status.textContent='处理失败，请重试';};task.postMessage({id,action:'encode-file',buffer},[buffer]);
 };
 const update=()=>{revision++;stop();const value=mode.value as Mode,textMode=value==='encode-text'||value==='decode-text';tabs.hidden=!textMode;fileCodec.hidden=fileCodecField.hidden=value!=='decode-file';choose.hidden=value!=='encode-file';name.hidden=value!=='encode-file';input.parentElement!.hidden=value==='encode-file';output.parentElement!.hidden=value==='decode-file';run.hidden=textMode;run.textContent=value==='decode-file'?'解码并保存':'编码文件';name.textContent=file.files?.[0]?.name||'';clear();if(textMode)schedule(0);};
 tabs.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-codec]');if(!button||!tabs.contains(button))return;selected=button.dataset.codec as TextCodec;for(const tab of tabs.querySelectorAll<HTMLButtonElement>('[data-codec]'))tab.setAttribute('aria-selected',String(tab===button));if(mode.value==='encode-text'){show();if(encodings[selected]&&!encodings[selected]?.error)status.textContent='已生成全部编码';}else schedule(0);};
 tabs.onkeydown=event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;const buttons=[...tabs.querySelectorAll<HTMLButtonElement>('[data-codec]')],index=buttons.findIndex(button=>button.dataset.codec===selected),next=buttons[(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];event.preventDefault();next.focus();next.click();};
 mode.onchange=update;input.oninput=()=>schedule();choose.onclick=()=>file.click();file.onchange=()=>{name.textContent=file.files?.[0]?.name||'';if(file.files?.length)void executeFile();};
 run.onclick=()=>{if(mode.value==='encode-file'){void executeFile();return;}const id=++revision;stop();clear();void api.codecExportFile(input.value,fileCodec.value as BinaryCodec).then(path=>{if(id===revision)status.textContent=path?'已保存文件':'已取消保存';}).catch(error=>{if(id===revision)status.textContent=errorMessage(error);});};
 cancel.onclick=()=>{revision++;stop();status.textContent='已取消';};
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制结果')).catch(toast);
 save.onclick=()=>void api.saveText(output.value,'UTF-8').then(path=>{if(path)status.textContent='已导出文本';}).catch(toast);
 installFileDropOverlay(q('page-base64'),{title:'编码文件',detail:'松开以读取文件并生成编码',acceptVirtualFiles:true,onDrop:(_paths,event)=>{const dropped=event.dataTransfer?.files;if(!dropped?.length)return;mode.value='encode-file';update();file.files=dropped;name.textContent=dropped[0].name;void executeFile();}});
 update();return {activate(value:boolean){if(!value&&(worker||timer)){revision++;stop();status.textContent='已取消';}},dispose(){revision++;stop();}};
}
