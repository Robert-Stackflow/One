import './developer-hash.css';
import {api,q,toast,errorMessage} from './ui';
import type {HashAlgorithm,HashRequest,HashResult,HashProgress} from '../shared/developer-hash';

export function developerHashPage(){return `<div class="developer-hash-page"><header class="developer-hash-heading"><h2>哈希与校验</h2><p>计算 UTF-8 文本或文件摘要，并可用预期摘要校验；原文件不会修改。</p></header>
 <div class="developer-hash-layout"><section class="settings-card developer-hash-panel" aria-label="哈希设置"><h3>计算设置</h3>
 <div class="developer-hash-options"><label>来源<select id="developer-hash-kind"><option value="text">文本</option><option value="file">文件</option></select></label><label>算法<select id="developer-hash-algorithm"><option value="sha256">SHA-256</option><option value="sha512">SHA-512</option><option value="sha1">SHA-1</option><option value="md5">MD5</option></select></label></div>
 <label id="developer-hash-text-field" class="developer-hash-text">文本内容<textarea id="developer-hash-text" spellcheck="false" maxlength="2097152"></textarea></label>
 <div id="developer-hash-file-field" class="developer-hash-file" hidden><input id="developer-hash-file" aria-label="文件路径" readonly placeholder="选择或拖入文件"><button id="developer-hash-pick" type="button">选择文件</button></div>
 <label class="developer-hash-expected">预期摘要（可选）<input id="developer-hash-expected" spellcheck="false" placeholder="粘贴十六进制摘要以校验"></label>
 <div class="developer-hash-actions"><button id="developer-hash-run" type="button">计算摘要</button><button id="developer-hash-cancel" type="button" hidden>取消</button></div><span id="developer-hash-status" role="status" aria-live="polite"></span></section>
 <section class="settings-card developer-hash-panel developer-hash-result" aria-label="哈希结果"><header><h3>计算结果</h3><button id="developer-hash-copy" type="button" disabled>复制摘要</button></header><code id="developer-hash-digest">尚未计算</code><span id="developer-hash-match"></span></section></div></div>`;}

export function setupDeveloperHash(){
 const kind=q<HTMLSelectElement>('developer-hash-kind'),algorithm=q<HTMLSelectElement>('developer-hash-algorithm'),text=q<HTMLTextAreaElement>('developer-hash-text'),file=q<HTMLInputElement>('developer-hash-file'),expected=q<HTMLInputElement>('developer-hash-expected');
 const textField=q<HTMLElement>('developer-hash-text-field'),fileField=q<HTMLElement>('developer-hash-file-field'),pick=q<HTMLButtonElement>('developer-hash-pick'),run=q<HTMLButtonElement>('developer-hash-run'),cancel=q<HTMLButtonElement>('developer-hash-cancel'),copy=q<HTMLButtonElement>('developer-hash-copy');
 const status=q<HTMLElement>('developer-hash-status'),digest=q<HTMLElement>('developer-hash-digest'),match=q<HTMLElement>('developer-hash-match');let running=false,current='';
 const render=()=>{const isFile=kind.value==='file';textField.hidden=isFile;fileField.hidden=!isFile;for(const input of [kind,algorithm,text,expected,pick])input.disabled=running;run.disabled=running;cancel.hidden=!running;copy.disabled=!current;};
 const progress=(value:HashProgress)=>{if(running)status.textContent=`正在读取 ${Math.round(value.processed/1048576*10)/10} / ${Math.round(value.total/1048576*10)/10} MB`;};
 const execute=async()=>{const request:HashRequest=kind.value==='file'?{kind:'file',path:file.value,algorithm:algorithm.value as HashAlgorithm,expected:expected.value||undefined}:{kind:'text',text:text.value,algorithm:algorithm.value as HashAlgorithm,expected:expected.value||undefined};
  if(request.kind==='file'&&!request.path){toast(Error('请先选择文件'));return;}running=true;current='';digest.textContent='正在计算…';match.textContent='';status.textContent='正在计算…';render();
  try{const result:HashResult=await api.developerHashStart(request);current=result.digest;digest.textContent=result.digest;match.textContent=result.match===undefined?`已读取 ${result.bytes} 字节`:result.match?'校验一致':'校验不一致';match.dataset.match=result.match===undefined?'':String(result.match);status.textContent='计算完成';}
  catch(error){digest.textContent='计算失败';status.textContent=errorMessage(error);}finally{running=false;render();}
 };
 kind.onchange=render;pick.onclick=()=>void api.pickFile(file.value||undefined).then(path=>{if(path)file.value=path;}).catch(toast);
 fileField.ondragover=event=>{event.preventDefault();event.dataTransfer!.dropEffect='copy';};fileField.ondrop=event=>{event.preventDefault();const item=event.dataTransfer?.files[0];if(item)try{file.value=api.droppedFile(item);}catch(error){toast(error);}};
 run.onclick=()=>void execute();cancel.onclick=()=>void api.developerHashCancel().catch(toast);copy.onclick=()=>void api.copyText(current).then(()=>toast('已复制摘要')).catch(toast);
 const unsubscribe=api.onDeveloperHashProgress(progress);render();return {activate(value:boolean){if(!value&&running)void api.developerHashCancel();},dispose(){unsubscribe();if(running)void api.developerHashCancel();}};
}
