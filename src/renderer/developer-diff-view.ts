import './developer-diff.css';
import {esc,q} from './ui';
import type {FileToolRow} from '../shared/file-tools';

interface DiffResult {rows:FileToolRow[];count:number;stats:{addedLines:number;removedLines:number;leftLines:number;rightLines:number};grouped:boolean}

export function developerDiffPage(){return `<div class="developer-diff-page">
 <div class="developer-diff-inputs"><label class="settings-card">原始文本<textarea id="developer-diff-left" spellcheck="false" maxlength="200000"></textarea></label><label class="settings-card">对照文本<textarea id="developer-diff-right" spellcheck="false" maxlength="200000"></textarea></label></div>
 <section class="settings-card developer-diff-controls" aria-label="比较设置"><div class="developer-diff-actions"><label><input id="developer-diff-whitespace" type="checkbox">忽略行首尾空白</label><button id="developer-diff-run" type="button">比较</button><button id="developer-diff-cancel" type="button" hidden>取消</button><span id="developer-diff-status" role="status" aria-live="polite"></span></div></section>
 <section class="settings-card developer-diff-output" aria-label="比较结果"><div class="developer-diff-nav"><button id="developer-diff-prev" type="button" disabled>上一处</button><span id="developer-diff-position">尚未比较</span><button id="developer-diff-next" type="button" disabled>下一处</button></div>
 <div id="developer-diff-results" class="developer-diff-results" aria-label="文本差异"></div></section></div>`;}

export function setupDeveloperDiff(){
 const left=q<HTMLTextAreaElement>('developer-diff-left'),right=q<HTMLTextAreaElement>('developer-diff-right'),whitespace=q<HTMLInputElement>('developer-diff-whitespace');
 const run=q<HTMLButtonElement>('developer-diff-run'),cancel=q<HTMLButtonElement>('developer-diff-cancel'),prev=q<HTMLButtonElement>('developer-diff-prev'),next=q<HTMLButtonElement>('developer-diff-next');
 const status=q<HTMLElement>('developer-diff-status'),position=q<HTMLElement>('developer-diff-position'),results=q<HTMLElement>('developer-diff-results');
 let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,revision=0,selected=0,rows:FileToolRow[]=[];
 const stop=()=>{if(timer)clearTimeout(timer);timer=undefined;worker?.terminate();worker=undefined;run.disabled=false;cancel.hidden=true;};
 const select=(index:number)=>{if(!rows.length)return;selected=(index+rows.length)%rows.length;results.querySelectorAll<HTMLElement>('[data-diff-row]').forEach((node,i)=>{node.dataset.selected=String(i===selected);});const active=results.querySelector<HTMLElement>(`[data-diff-row="${selected}"]`);active?.scrollIntoView({block:'nearest'});position.textContent=`${selected+1} / ${rows.length}`;};
 const render=(value:DiffResult)=>{rows=value.rows;results.innerHTML=rows.length?rows.map((row,index)=>`<article class="developer-diff-card" data-diff-row="${index}" data-selected="false"><header><strong>${esc(row.status)}</strong><span>原始第 ${row.oldLine} 行 · 对照第 ${row.newLine} 行</span></header><div><pre>${esc(row.leftText||'')}</pre><pre>${esc(row.rightText||'')}</pre></div></article>`).join(''):'<p class="developer-diff-empty">两侧文本没有差异。</p>';prev.disabled=next.disabled=!rows.length;position.textContent=rows.length?'':'无差异';if(rows.length)select(0);status.textContent=`${value.count} 处差异，新增 ${value.stats.addedLines} 行，删除 ${value.stats.removedLines} 行${value.count>rows.length?`；仅展示前 ${rows.length} 处`:''}${value.grouped?'；大段变化已合并':''}`;};
 const compare=()=>{revision++;stop();const id=revision;if(left.value.length>200_000||right.value.length>200_000){status.textContent='两侧文本各不能超过 200,000 字符';return;}status.textContent='正在比较…';results.replaceChildren();rows=[];prev.disabled=next.disabled=true;position.textContent='';run.disabled=true;cancel.hidden=false;
  const task=new Worker(new URL('./developer-diff-worker.ts',import.meta.url),{type:'module'});worker=task;timer=setTimeout(()=>{if(id!==revision)return;revision++;stop();status.textContent='比较超过 2 秒，已停止。请缩短文本。';},2000);
  task.onmessage=(event:MessageEvent<{id:number;result?:DiffResult;error?:string}>)=>{if(id!==revision)return;stop();if(event.data.error){status.textContent=event.data.error;return;}if(event.data.result)render(event.data.result);};
  task.onerror=()=>{if(id!==revision)return;stop();status.textContent='比较失败，请重试';};task.postMessage({id,left:left.value,right:right.value,ignoreWhitespace:whitespace.checked});
 };
 run.onclick=compare;cancel.onclick=()=>{revision++;stop();status.textContent='已取消';};prev.onclick=()=>select(selected-1);next.onclick=()=>select(selected+1);
 return {activate(value:boolean){if(!value&&worker){revision++;stop();status.textContent='已取消';}},dispose(){revision++;stop();}};
}
