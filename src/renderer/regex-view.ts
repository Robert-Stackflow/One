import './regex.css';
import {api,q,esc,toast} from './ui';
import {toolInfo} from './tool-page-components';
import type {RegexRequest,RegexResult} from '../shared/regex-tool';

const snippets=[
 {id:'digits',label:'数字',text:'\\d+'},
 {id:'space',label:'空白',text:'\\s+'},
 {id:'word',label:'单词',text:'\\b\\w+\\b'},
 {id:'boundary',label:'单词边界',text:'\\b'},
 {id:'group',label:'捕获组',text:'()',cursor:1},
 {id:'named',label:'命名组',text:'(?<name>)',cursor:8},
 {id:'noncapture',label:'非捕获组',text:'(?:)',cursor:3}
];

export function regexPage(){return `<div class="regex-page">
 <section class="settings-card regex-settings" aria-label="正则设置"><div class="tool-card-head"><h3>正则表达式</h3>${toolInfo('正则测试提示','输入表达式和测试文本后自动匹配；运行超过 500 毫秒会停止。')}</div><div class="regex-pattern"><label for="regex-pattern">表达式</label><input id="regex-pattern" spellcheck="false" placeholder="例如 (?<name>\\w+)"></div>
 <div id="regex-snippets" class="regex-snippets"><span>常用片段</span><div>${snippets.map(item=>`<button type="button" data-regex-snippet="${item.id}">${item.label}</button>`).join('')}</div></div>
 <div class="regex-flags" role="group" aria-label="正则选项"><span>选项</span><label><input type="checkbox" data-regex-flag="g" checked>全局 g</label><label><input type="checkbox" data-regex-flag="i">忽略大小写 i</label><label><input type="checkbox" data-regex-flag="m">多行 m</label><label><input type="checkbox" data-regex-flag="s">点匹配换行 s</label><label><input type="checkbox" data-regex-flag="u">Unicode u</label></div>
 <div class="regex-actions"><button id="regex-test" type="button">测试匹配</button><button id="regex-single" type="button" disabled>替换当前处</button><button id="regex-preview" type="button">替换全部</button><button id="regex-cancel" type="button" hidden>取消</button><span id="regex-status" role="status" aria-live="polite"></span></div></section>
 <div class="regex-columns"><section class="settings-card regex-panel"><div class="tool-card-head regex-input-heading"><label for="regex-input">测试文本</label><div class="regex-nav"><button id="regex-highlight-toggle" type="button" disabled>高亮匹配</button><button id="regex-prev" type="button" disabled>上一处</button><span id="regex-position" aria-live="polite"></span><button id="regex-next" type="button" disabled>下一处</button></div></div><textarea id="regex-input" spellcheck="false"></textarea><div id="regex-highlights" class="regex-highlights" aria-label="匹配高亮" hidden></div></section><section class="settings-card regex-panel"><div class="tool-card-head"><label for="regex-replacement">替换文本</label></div><textarea id="regex-replacement" spellcheck="false" placeholder="例如 $& 或 $<name>"></textarea></section></div>
 <div class="regex-columns"><section class="settings-card regex-results"><div class="tool-card-head regex-result-heading"><h3>匹配结果</h3><span id="regex-count"></span><button id="regex-export" type="button" disabled>导出 JSON</button></div><div id="regex-matches" class="regex-match-list"></div></section>
 <section class="settings-card regex-results"><div class="tool-card-head regex-result-heading"><h3>替换结果</h3><div><button id="regex-apply" type="button" disabled>应用到文本</button><button id="regex-copy" type="button" disabled>复制结果</button></div></div><textarea id="regex-output" readonly spellcheck="false"></textarea></section></div></div>`;}

export function setupRegex(){
 const pattern=q<HTMLInputElement>('regex-pattern'),input=q<HTMLTextAreaElement>('regex-input'),replacement=q<HTMLTextAreaElement>('regex-replacement'),output=q<HTMLTextAreaElement>('regex-output');
 const status=q<HTMLElement>('regex-status'),count=q<HTMLElement>('regex-count'),list=q<HTMLElement>('regex-matches'),test=q<HTMLButtonElement>('regex-test'),preview=q<HTMLButtonElement>('regex-preview'),single=q<HTMLButtonElement>('regex-single'),cancel=q<HTMLButtonElement>('regex-cancel'),copy=q<HTMLButtonElement>('regex-copy'),apply=q<HTMLButtonElement>('regex-apply');
 const prev=q<HTMLButtonElement>('regex-prev'),next=q<HTMLButtonElement>('regex-next'),position=q<HTMLElement>('regex-position'),exportButton=q<HTMLButtonElement>('regex-export'),highlightToggle=q<HTMLButtonElement>('regex-highlight-toggle'),highlights=q<HTMLElement>('regex-highlights');
 const snippetPanel=q<HTMLElement>('regex-snippets');
 const flags=[...document.querySelectorAll<HTMLInputElement>('[data-regex-flag]')];let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,inputTimer:ReturnType<typeof setTimeout>|undefined,revision=0,matches:RegexResult['matches']=[],selected=0,lastResult:RegexResult|undefined,lastRequest:RegexRequest|undefined,highlightOpen=false;
 const stop=()=>{if(timer)clearTimeout(timer);timer=undefined;worker?.terminate();worker=undefined;test.disabled=preview.disabled=false;single.disabled=!matches.length;cancel.hidden=true;};
 const revealIn=(container:HTMLElement,node:HTMLElement)=>{const item=node.getBoundingClientRect(),frame=container.getBoundingClientRect();if(item.top<frame.top)container.scrollTop+=item.top-frame.top;else if(item.bottom>frame.bottom)container.scrollTop+=item.bottom-frame.bottom;};
 const drawHighlights=()=>{highlights.hidden=!highlightOpen||!matches.length;if(highlights.hidden||!lastRequest)return;let cursor=0;const parts:string[]=[];matches.forEach((match,index)=>{parts.push(esc(lastRequest!.text.slice(cursor,match.start)));parts.push(`<mark data-regex-highlight="${index}"${index===selected?' data-selected="true"':''}>${match.end===match.start?'∅':esc(lastRequest!.text.slice(match.start,match.end))}</mark>`);cursor=match.end;});parts.push(esc(lastRequest.text.slice(cursor)));highlights.innerHTML=`<pre>${parts.join('')}</pre>`;};
 const select=(index:number,reveal:boolean)=>{if(!matches.length)return;selected=(index+matches.length)%matches.length;position.textContent=`${selected+1} / ${matches.length}`;list.querySelectorAll<HTMLElement>('[data-regex-match]').forEach((node,i)=>{node.dataset.selected=String(i===selected);node.setAttribute('aria-current',i===selected?'true':'false');});highlights.querySelectorAll<HTMLElement>('[data-regex-highlight]').forEach((node,i)=>{node.dataset.selected=String(i===selected);});if(reveal){const match=matches[selected],node=list.querySelector<HTMLElement>(`[data-regex-match="${selected}"]`),mark=highlights.querySelector<HTMLElement>(`[data-regex-highlight="${selected}"]`);if(node)revealIn(list,node);if(mark&&!highlights.hidden)revealIn(highlights,mark);input.focus();input.setSelectionRange(match.start,match.end);}};
 const clear=()=>{matches=[];selected=0;lastResult=lastRequest=undefined;count.textContent='';position.textContent='';prev.disabled=next.disabled=single.disabled=exportButton.disabled=highlightToggle.disabled=true;list.replaceChildren();highlights.replaceChildren();highlights.hidden=true;output.value='';copy.disabled=apply.disabled=true;};
 const render=(result:RegexResult,request:RegexRequest)=>{matches=result.matches;lastResult=result;lastRequest=request;exportButton.disabled=false;count.textContent=`${matches.length}${result.truncated?'+':''} 个匹配${result.truncated?'（只显示前 100 个）':''}`;
  list.innerHTML=matches.length?matches.map((match,index)=>`<button type="button" class="regex-match" data-regex-match="${index}" aria-label="第 ${index+1} 处匹配，字符 ${match.start} 到 ${match.end}"><strong>#${index+1} · ${match.start}–${match.end}</strong><code>${esc(match.value||'∅')}</code>${match.groups.length?`<span class="regex-match-groups">捕获组：${match.groups.map((value,i)=>`<span>$${i+1} = <code>${esc(value??'未匹配')}</code></span>`).join('')}</span>`:''}${Object.keys(match.named).length?`<span class="regex-match-groups">命名组：${Object.entries(match.named).map(([key,value])=>`<span>${esc(key)} = <code>${esc(value??'未匹配')}</code></span>`).join('')}</span>`:''}</button>`).join(''):'<p>没有匹配结果。</p>';
  prev.disabled=next.disabled=matches.length<2;single.disabled=highlightToggle.disabled=!matches.length;if(matches.length){selected=request.selectedIndex??0;drawHighlights();select(selected,false);}else position.textContent='';
  output.value=result.preview??'';copy.disabled=result.preview===undefined;apply.disabled=result.preview===undefined||result.preview.length>100_000;};
 const run=(replace:boolean,selectedIndex?:number)=>{if(inputTimer)clearTimeout(inputTimer);inputTimer=undefined;stop();const id=++revision;const request:RegexRequest={pattern:pattern.value,flags:flags.filter(field=>field.checked).map(field=>field.dataset.regexFlag).join(''),text:input.value,replacement:replacement.value,replace,selectedIndex};
  if(request.pattern.length>2000||request.text.length>100_000||request.replacement.length>200){status.textContent='输入过长：表达式限 2,000 字符，测试文本限 100,000 字符，替换文本限 200 字符';return;}
  status.textContent='正在处理…';clear();test.disabled=preview.disabled=single.disabled=true;cancel.hidden=false;
  const task=new Worker(new URL('./regex-worker.ts',import.meta.url),{type:'module'});worker=task;
  timer=setTimeout(()=>{if(id!==revision)return;revision++;stop();status.textContent='匹配超过 500 毫秒，已自动停止。请简化表达式或缩短文本。';},500);
  task.onmessage=(event:MessageEvent<{id:number;result?:RegexResult;error?:string}>)=>{if(id!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}if(event.data.result){render(event.data.result,request);status.textContent=replace?'替换预览已生成':'匹配完成';}};
  task.onerror=()=>{if(id!==revision)return;stop();status.textContent='处理失败，请重试';};
  task.postMessage({id,request});
 };
 const schedule=(replace=false)=>{if(inputTimer)clearTimeout(inputTimer);revision++;stop();clear();status.textContent='';if(pattern.value)inputTimer=setTimeout(()=>{inputTimer=undefined;run(replace);},200);};
 test.onclick=()=>run(false);preview.onclick=()=>run(true);single.onclick=()=>run(true,selected);cancel.onclick=()=>{if(inputTimer)clearTimeout(inputTimer);inputTimer=undefined;revision++;stop();status.textContent='已取消';};
 prev.onclick=()=>select(selected-1,true);next.onclick=()=>select(selected+1,true);
 highlightToggle.onclick=()=>{highlightOpen=!highlightOpen;highlightToggle.textContent=highlightOpen?'隐藏高亮':'高亮匹配';drawHighlights();};
 list.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('[data-regex-match]');if(button&&list.contains(button))select(Number(button.dataset.regexMatch),true);};
 highlights.onclick=event=>{const mark=(event.target as HTMLElement).closest<HTMLElement>('[data-regex-highlight]');if(mark&&highlights.contains(mark))select(Number(mark.dataset.regexHighlight),true);};
 snippetPanel.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-regex-snippet]'),item=snippets.find(value=>value.id===button?.dataset.regexSnippet);if(!item)return;const start=pattern.selectionStart??pattern.value.length,end=pattern.selectionEnd??start;if(pattern.value.length-end+start+item.text.length>2000){status.textContent='表达式不能超过 2,000 字符';return;}pattern.setRangeText(item.text,start,end,'end');const cursor=start+(item.cursor??item.text.length);pattern.focus();pattern.setSelectionRange(cursor,cursor);pattern.dispatchEvent(new Event('input',{bubbles:true}));};
 for(const field of [pattern,input,...flags])field.addEventListener(field instanceof HTMLInputElement&&field.type==='checkbox'?'change':'input',()=>schedule());
 replacement.addEventListener('input',()=>schedule(true));
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制结果')).catch(toast);
 apply.onclick=()=>{if(apply.disabled)return;input.value=output.value;schedule();};
 exportButton.onclick=()=>{if(!lastResult||!lastRequest)return;const content=JSON.stringify({pattern:lastRequest.pattern,flags:lastRequest.flags,textLength:lastRequest.text.length,truncated:lastResult.truncated,matchValueMaxCharacters:300,matches:lastResult.matches},null,2);void api.saveText(content,'UTF-8','正则匹配.json').then(path=>{if(path)toast('已导出匹配结果');}).catch(toast);};
 return {activate(value:boolean){if(!value&&(worker||inputTimer)){if(inputTimer)clearTimeout(inputTimer);revision++;stop();status.textContent='已取消';}},dispose(){if(inputTimer)clearTimeout(inputTimer);revision++;stop();}};
}
