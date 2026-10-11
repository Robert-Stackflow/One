import './developer-hash.css';
import {api,q,toast,errorMessage} from './ui';
import type {HashAlgorithm,HashAllRequest,HashAllResult,HashProgress} from '../shared/developer-hash';
import {installToolFileDrop,toolInfo} from './tool-page-components';

const algorithms:[HashAlgorithm,string][]=[['sha256','SHA-256'],['sha512','SHA-512'],['sha1','SHA-1'],['md5','MD5']];
const lengths:Record<HashAlgorithm,number>={sha256:64,sha512:128,sha1:40,md5:32};

export function developerHashPage(){return `<div class="developer-hash-page">
 <div class="developer-hash-layout"><section class="settings-card developer-hash-panel" aria-label="哈希输入"><div class="tool-card-head"><h3>输入</h3>${toolInfo('哈希说明','文件只读取一次，即可生成四种摘要；MD5 和 SHA-1 仅适合兼容性校验。')}</div>
 <div class="developer-hash-options"><label>来源<select id="developer-hash-kind"><option value="text">文本</option><option value="file">文件</option></select></label></div>
 <label id="developer-hash-text-field" class="developer-hash-text">文本内容<textarea id="developer-hash-text" spellcheck="false" maxlength="2097152" placeholder="输入后自动计算全部摘要"></textarea></label>
 <div id="developer-hash-file-field" class="developer-hash-file" hidden><input id="developer-hash-file" aria-label="文件路径" readonly placeholder="选择或拖入文件"><button id="developer-hash-pick" type="button">选择文件</button></div>
 <div class="developer-hash-actions"><button id="developer-hash-cancel" type="button" hidden>取消</button></div><span id="developer-hash-status" role="status" aria-live="polite"></span></section>
 <section class="settings-card developer-hash-panel developer-hash-result" aria-label="哈希结果"><header><h3>摘要</h3><button id="developer-hash-copy" type="button" disabled>复制摘要</button></header>
 <div id="developer-hash-tabs" class="developer-hash-tabs" role="tablist" aria-label="哈希算法">${algorithms.map(([id,label],index)=>`<button type="button" role="tab" data-hash-algorithm="${id}" aria-selected="${index===0}" aria-controls="developer-hash-digest">${label}</button>`).join('')}</div>
 <code id="developer-hash-digest">输入文本或选择文件</code><label class="developer-hash-expected">预期摘要（可选）<input id="developer-hash-expected" spellcheck="false" placeholder="粘贴当前算法的十六进制摘要"></label><span id="developer-hash-match"></span></section></div></div>`;}

export function setupDeveloperHash(){
 const kind=q<HTMLSelectElement>('developer-hash-kind'),text=q<HTMLTextAreaElement>('developer-hash-text'),file=q<HTMLInputElement>('developer-hash-file'),expected=q<HTMLInputElement>('developer-hash-expected'),tabs=q<HTMLElement>('developer-hash-tabs');
 const textField=q<HTMLElement>('developer-hash-text-field'),fileField=q<HTMLElement>('developer-hash-file-field'),pick=q<HTMLButtonElement>('developer-hash-pick'),cancel=q<HTMLButtonElement>('developer-hash-cancel'),copy=q<HTMLButtonElement>('developer-hash-copy'),status=q<HTMLElement>('developer-hash-status'),digest=q<HTMLElement>('developer-hash-digest'),match=q<HTMLElement>('developer-hash-match');
 let current:HashAllResult|undefined,selected:HashAlgorithm='sha256',running=false,queued=false,revision=0,timer:ReturnType<typeof setTimeout>|undefined;
 const show=()=>{const value=current?.digests[selected];digest.textContent=value||'输入文本或选择文件';copy.disabled=!value;const check=expected.value.replace(/\s+/g,'').toLowerCase();if(!value){match.textContent='';match.dataset.match='';return;}if(!check){match.textContent=`已读取 ${current!.bytes} 字节`;match.dataset.match='';return;}if(!new RegExp(`^[0-9a-f]{${lengths[selected]}}$`).test(check)){match.textContent='校验值长度或十六进制格式无效';match.dataset.match='false';return;}const same=value===check;match.textContent=same?'校验一致':'校验不一致';match.dataset.match=String(same);};
 const render=()=>{const isFile=kind.value==='file';textField.hidden=isFile;fileField.hidden=!isFile;cancel.hidden=!running;show();};
 const progress=(value:HashProgress)=>{if(running&&!queued&&kind.value==='file')status.textContent=`正在读取 ${(value.processed/1048576).toFixed(1)} / ${(value.total/1048576).toFixed(1)} MB`;};
 const execute=()=>{timer=undefined;const request:HashAllRequest=kind.value==='file'?{kind:'file',path:file.value}:{kind:'text',text:text.value};if(request.kind==='file'&&!request.path||request.kind==='text'&&!request.text){current=undefined;status.textContent='';render();return;}if(running){queued=true;void api.developerHashCancel();return;}
  const id=revision;running=true;current=undefined;status.textContent='正在计算…';render();void api.developerHashAllStart(request).then(value=>{if(id!==revision)return;current=value;status.textContent='已生成全部摘要';}).catch(error=>{if(id===revision)status.textContent=errorMessage(error);}).finally(()=>{running=false;if(queued){queued=false;execute();}else render();});
 };
 const schedule=(delay=180)=>{revision++;if(timer)clearTimeout(timer);if(running)void api.developerHashCancel();current=undefined;status.textContent='';render();timer=setTimeout(execute,delay);};
 kind.onchange=()=>schedule(0);text.oninput=()=>schedule();expected.oninput=show;
 file.onchange=()=>schedule(0);
 pick.onclick=()=>void api.pickFile(file.value||undefined).then(path=>{if(path){file.value=path;schedule(0);}}).catch(toast);
 installToolFileDrop(q('page-developer-hash'),'计算文件摘要',paths=>{kind.value='file';file.value=paths[0];schedule(0);});
 tabs.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-hash-algorithm]');if(!button||!tabs.contains(button))return;selected=button.dataset.hashAlgorithm as HashAlgorithm;for(const tab of tabs.querySelectorAll<HTMLButtonElement>('[data-hash-algorithm]'))tab.setAttribute('aria-selected',String(tab===button));show();};
 tabs.onkeydown=event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;const buttons=[...tabs.querySelectorAll<HTMLButtonElement>('[data-hash-algorithm]')],index=buttons.findIndex(button=>button.dataset.hashAlgorithm===selected),next=buttons[(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];event.preventDefault();next.focus();next.click();};
 cancel.onclick=()=>{revision++;if(timer)clearTimeout(timer);queued=false;void api.developerHashCancel().catch(toast);status.textContent='已取消';};
 copy.onclick=()=>{const value=current?.digests[selected];if(value)void api.copyText(value).then(()=>toast('已复制摘要')).catch(toast);};
 const unsubscribe=api.onDeveloperHashProgress(progress);render();return {activate(value:boolean){if(!value&&running){revision++;queued=false;void api.developerHashCancel();}},dispose(){unsubscribe();revision++;if(timer)clearTimeout(timer);queued=false;if(running)void api.developerHashCancel();}};
}
