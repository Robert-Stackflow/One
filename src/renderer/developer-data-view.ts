import {api,q,toast} from './ui';
import type {DeveloperDataAction,DeveloperDataFormat,DeveloperDataResult} from '../shared/developer-data';
import './developer-data.css';

export function developerDataPage(){return `<div class="developer-data" id="developer-data">
 <header class="developer-data-heading"><h2>JSON / YAML</h2><p>在本机校验、格式化、压缩或转换，原始输入始终保留。</p></header>
 <section class="settings-card developer-data-settings" aria-label="数据处理设置"><h3>处理设置</h3><div class="developer-data-toolbar"><label for="developer-data-format">输入格式</label><select id="developer-data-format"><option value="json">JSON</option><option value="yaml">YAML</option></select><span class="developer-data-spacer"></span><button type="button" data-data-action="validate">校验</button><button type="button" data-data-action="format" class="primary">格式化</button><button type="button" data-data-action="compact">压缩</button><button type="button" data-data-action="convert">转换格式</button><button type="button" id="developer-data-cancel" hidden>取消</button></div>
 <div id="developer-data-status" class="developer-data-status" role="status" aria-live="polite">输入 JSON 或 YAML 后选择操作；压缩或转换 YAML 会移除注释，原输入保留。所有内容仅在本机处理。</div></section>
 <div class="developer-data-columns"><section class="settings-card developer-data-panel"><label for="developer-data-input">输入</label><textarea id="developer-data-input" spellcheck="false" placeholder="在这里粘贴 JSON 或 YAML" aria-describedby="developer-data-status"></textarea></section><section class="settings-card developer-data-panel"><div class="developer-data-result-heading"><label for="developer-data-output">结果</label><button type="button" id="developer-data-copy" disabled>复制结果</button></div><textarea id="developer-data-output" readonly spellcheck="false" aria-label="处理结果"></textarea></section></div>
 </div>`;}

export function setupDeveloperData(){
 const input=q<HTMLTextAreaElement>('developer-data-input'),output=q<HTMLTextAreaElement>('developer-data-output'),source=q<HTMLSelectElement>('developer-data-format'),status=q('developer-data-status'),cancel=q<HTMLButtonElement>('developer-data-cancel'),copy=q<HTMLButtonElement>('developer-data-copy');
 let worker:Worker|undefined,id=0;
 const stop=()=>{worker?.terminate();worker=undefined;cancel.hidden=true;for(const button of document.querySelectorAll<HTMLButtonElement>('[data-data-action]'))button.disabled=false;};
 const position=(line:number,column:number)=>{const lines=input.value.split(/\r\n|\r|\n/),before=lines.slice(0,line-1).reduce((n,row)=>n+row.length+1,0),offset=Math.min(input.value.length,before+column-1);input.focus();input.setSelectionRange(offset,offset);};
 const run=(action:DeveloperDataAction)=>{
  stop();const current=++id;output.value='';copy.disabled=true;status.dataset.state='busy';status.textContent='正在处理…';cancel.hidden=false;for(const button of document.querySelectorAll<HTMLButtonElement>('[data-data-action]'))button.disabled=true;
  const task=new Worker(new URL('./developer-data-worker.ts',import.meta.url),{type:'module'});worker=task;
  task.onmessage=(event:MessageEvent<{id:number;result?:DeveloperDataResult;error?:{message:string;line:number;column:number}}>)=>{
   if(event.data.id!==current||worker!==task)return;stop();
   if(event.data.error){const {message,line,column}=event.data.error;status.dataset.state='error';status.textContent=`第 ${line} 行，第 ${column} 列：${message}`;position(line,column);return;}
   const result=event.data.result!;status.dataset.state='success';status.textContent=result.message;output.value=result.text;output.dataset.format=result.format;copy.disabled=!result.text;
  };
  task.onerror=()=>{if(worker!==task)return;stop();status.dataset.state='error';status.textContent='处理失败，请检查输入后重试。';};
  task.postMessage({id:current,request:{source:source.value as DeveloperDataFormat,action,text:input.value}});
 };
 document.querySelectorAll<HTMLButtonElement>('[data-data-action]').forEach(button=>button.onclick=()=>run(button.dataset.dataAction as DeveloperDataAction));
 cancel.onclick=()=>{stop();status.dataset.state='';status.textContent='已取消';};
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制结果')).catch(toast);
 return {activate(value:boolean){if(!value&&worker){stop();status.dataset.state='';status.textContent='已取消';}},dispose(){stop();}};
}
