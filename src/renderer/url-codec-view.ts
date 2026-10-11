import './url-codec.css';
import {api,q,toast} from './ui';
import type {URLCodecScope,URLCodecAction} from '../shared/url-codec';

export function urlCodecPage(){return `<div class="url-codec-page"><header class="url-codec-heading"><h2>URL 编解码</h2><p>在本机处理完整 URL 或单个参数值，原始输入始终保留。</p></header>
 <section class="settings-card url-codec-settings" aria-label="编解码设置"><h3>处理设置</h3><div class="url-codec-toolbar"><label for="url-codec-scope">处理内容</label><select id="url-codec-scope"><option value="url">完整 URL</option><option value="parameter">参数值</option></select><button type="button" data-url-action="encode">编码</button><button type="button" data-url-action="decode">解码</button><button type="button" id="url-codec-cancel" hidden>取消</button></div>
 <p>完整 URL 模式保留斜线、问号和参数分隔符；参数值模式会编码这些字符。解码参数值时，+ 按空格处理。</p><div id="url-codec-status" role="status" aria-live="polite">所有内容仅在本机处理。</div></section>
 <div class="url-codec-columns"><section class="settings-card url-codec-panel"><label for="url-codec-input">输入</label><textarea id="url-codec-input" spellcheck="false" placeholder="粘贴 URL 或参数值"></textarea></section><section class="settings-card url-codec-panel"><div><label for="url-codec-output">结果</label><button id="url-codec-copy" type="button" disabled>复制结果</button></div><textarea id="url-codec-output" readonly spellcheck="false"></textarea></section></div></div>`;}

export function setupURLCodec(){
 const scope=q<HTMLSelectElement>('url-codec-scope'),input=q<HTMLTextAreaElement>('url-codec-input'),output=q<HTMLTextAreaElement>('url-codec-output'),status=q<HTMLElement>('url-codec-status'),copy=q<HTMLButtonElement>('url-codec-copy'),cancel=q<HTMLButtonElement>('url-codec-cancel');
 const buttons=[...document.querySelectorAll<HTMLButtonElement>('[data-url-action]')];let worker:Worker|undefined,revision=0;
 const stop=()=>{worker?.terminate();worker=undefined;cancel.hidden=true;buttons.forEach(button=>button.disabled=false);};
 const run=(action:URLCodecAction)=>{stop();const id=++revision;output.value='';copy.disabled=true;status.textContent='正在处理…';buttons.forEach(button=>button.disabled=true);cancel.hidden=false;const task=new Worker(new URL('./url-codec-worker.ts',import.meta.url),{type:'module'});worker=task;
  task.onmessage=(event:MessageEvent<{id:number;result?:string;error?:string}>)=>{if(id!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}output.value=event.data.result||'';copy.disabled=!output.value;status.textContent=action==='encode'?'已编码':'已解码';};
  task.onerror=()=>{if(id!==revision)return;stop();status.textContent='处理失败，请重试';};
  task.postMessage({id,text:input.value,scope:scope.value as URLCodecScope,action});
 };
 buttons.forEach(button=>button.onclick=()=>run(button.dataset.urlAction as URLCodecAction));
 cancel.onclick=()=>{revision++;stop();status.textContent='已取消';};
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制结果')).catch(toast);
 return {activate(value:boolean){if(!value&&worker){revision++;stop();status.textContent='已取消';}},dispose(){revision++;stop();}};
}
