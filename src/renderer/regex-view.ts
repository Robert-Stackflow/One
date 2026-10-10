import './regex.css';
import {api,q,esc,toast} from './ui';
import type {RegexRequest,RegexResult} from '../shared/regex-tool';

export function regexPage(){return `<div class="regex-page"><div class="regex-heading"><h2>正则表达式测试</h2><p>输入表达式和测试文本，查看匹配位置、捕获组与替换预览。复杂匹配超过 500 毫秒会自动停止。</p></div>
 <div class="regex-pattern"><label for="regex-pattern">表达式</label><input id="regex-pattern" spellcheck="false" placeholder="例如 (?<name>\\w+)"></div>
 <fieldset class="regex-flags"><legend>选项</legend><label><input type="checkbox" data-regex-flag="g" checked>全局 g</label><label><input type="checkbox" data-regex-flag="i">忽略大小写 i</label><label><input type="checkbox" data-regex-flag="m">多行 m</label><label><input type="checkbox" data-regex-flag="s">点匹配换行 s</label><label><input type="checkbox" data-regex-flag="u">Unicode u</label></fieldset>
 <div class="regex-columns"><section><label for="regex-input">测试文本</label><textarea id="regex-input" spellcheck="false"></textarea></section><section><label for="regex-replacement">替换文本</label><textarea id="regex-replacement" spellcheck="false" placeholder="例如 $& 或 $<name>"></textarea></section></div>
 <div class="regex-actions"><button id="regex-test" type="button">测试匹配</button><button id="regex-preview" type="button">预览替换</button><button id="regex-cancel" type="button" hidden>取消</button><span id="regex-status" role="status" aria-live="polite"></span></div>
 <section class="regex-results"><div class="regex-result-heading"><h3>匹配结果</h3><span id="regex-count"></span></div><div id="regex-matches" class="regex-match-list"></div></section>
 <section class="regex-results"><div class="regex-result-heading"><h3>替换预览</h3><button id="regex-copy" type="button" disabled>复制结果</button></div><textarea id="regex-output" readonly spellcheck="false"></textarea></section></div>`;}

export function setupRegex(){
 const pattern=q<HTMLInputElement>('regex-pattern'),input=q<HTMLTextAreaElement>('regex-input'),replacement=q<HTMLTextAreaElement>('regex-replacement'),output=q<HTMLTextAreaElement>('regex-output');
 const status=q<HTMLElement>('regex-status'),count=q<HTMLElement>('regex-count'),list=q<HTMLElement>('regex-matches'),test=q<HTMLButtonElement>('regex-test'),preview=q<HTMLButtonElement>('regex-preview'),cancel=q<HTMLButtonElement>('regex-cancel'),copy=q<HTMLButtonElement>('regex-copy');
 const flags=[...document.querySelectorAll<HTMLInputElement>('[data-regex-flag]')];let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,revision=0;
 const stop=()=>{if(timer)clearTimeout(timer);timer=undefined;worker?.terminate();worker=undefined;test.disabled=preview.disabled=false;cancel.hidden=true;};
 const render=(result:RegexResult)=>{count.textContent=`${result.matches.length}${result.truncated?'+':''} 个匹配${result.truncated?'（只显示前 100 个）':''}`;
  list.innerHTML=result.matches.length?result.matches.map((match,index)=>`<article class="regex-match"><strong>#${index+1} · ${match.start}–${match.end}</strong><code>${esc(match.value||'∅')}</code>${match.groups.length?`<div>捕获组：${match.groups.map((value,i)=>`<span>$${i+1} = <code>${esc(value??'未匹配')}</code></span>`).join('')}</div>`:''}${Object.keys(match.named).length?`<div>命名组：${Object.entries(match.named).map(([key,value])=>`<span>${esc(key)} = <code>${esc(value??'未匹配')}</code></span>`).join('')}</div>`:''}</article>`).join(''):'<p>没有匹配结果。</p>';
  output.value=result.preview||'';copy.disabled=result.preview===undefined;};
 const run=(replace:boolean)=>{stop();const id=++revision;const request:RegexRequest={pattern:pattern.value,flags:flags.filter(field=>field.checked).map(field=>field.dataset.regexFlag).join(''),text:input.value,replacement:replacement.value,replace};
  if(request.pattern.length>2000||request.text.length>100_000||request.replacement.length>200){status.textContent='输入过长：表达式限 2,000 字符，测试文本限 100,000 字符，替换文本限 200 字符';return;}
  status.textContent='正在处理…';count.textContent='';list.replaceChildren();output.value='';copy.disabled=true;test.disabled=preview.disabled=true;cancel.hidden=false;
  const task=new Worker(new URL('./regex-worker.ts',import.meta.url),{type:'module'});worker=task;
  timer=setTimeout(()=>{if(id!==revision)return;revision++;stop();status.textContent='匹配超过 500 毫秒，已自动停止。请简化表达式或缩短文本。';},500);
  task.onmessage=(event:MessageEvent<{id:number;result?:RegexResult;error?:string}>)=>{if(id!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}if(event.data.result){render(event.data.result);status.textContent=replace?'替换预览已生成':'匹配完成';}};
  task.onerror=()=>{if(id!==revision)return;stop();status.textContent='处理失败，请重试';};
  task.postMessage({id,request});
 };
 test.onclick=()=>run(false);preview.onclick=()=>run(true);cancel.onclick=()=>{revision++;stop();status.textContent='已取消';};
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制结果')).catch(toast);
 return {activate(value:boolean){if(!value&&worker){revision++;stop();status.textContent='已取消';}},dispose(){revision++;stop();}};
}
