import './timestamp.css';
import {api,q,esc,toast} from './ui';
import {currentTimestamp,dateToTimestamp,timestampToDate,type TimestampResult,type TimestampUnit,type TimestampDisambiguation} from '../shared/timestamp';

export function timestampPage(){const local=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';return `<div class="timestamp-page">
 <div class="timestamp-head"><label for="timestamp-zone">时区<select id="timestamp-zone"><option value="local">系统本地（${esc(local)}）</option><option value="UTC">UTC</option><option value="Asia/Shanghai">上海（Asia/Shanghai）</option><option value="Asia/Tokyo">东京（Asia/Tokyo）</option><option value="Europe/London">伦敦（Europe/London）</option><option value="Europe/Berlin">柏林（Europe/Berlin）</option><option value="America/New_York">纽约（America/New_York）</option><option value="America/Los_Angeles">洛杉矶（America/Los_Angeles）</option></select></label></div>
 <section class="settings-card timestamp-now"><div><strong>当前时间</strong><span id="timestamp-now-date"></span><small id="timestamp-now-epoch"></small></div><button id="timestamp-use-now" type="button">填入当前时间</button></section>
 <div class="timestamp-grid"><section class="settings-card"><h3>时间戳 → 日期时间</h3><div class="timestamp-input-row"><label for="timestamp-number">时间戳</label><input id="timestamp-number" inputmode="decimal" spellcheck="false" placeholder="例如 1710052200"><select id="timestamp-unit" aria-label="时间戳单位"><option value="seconds">秒</option><option value="milliseconds">毫秒</option></select><button id="timestamp-to-date" type="button">换算</button></div><pre id="timestamp-date-result" aria-live="polite"></pre><button id="timestamp-copy-date" type="button" disabled>复制结果</button></section>
 <section class="settings-card"><h3>日期时间 → 时间戳</h3><div class="timestamp-input-row"><label for="timestamp-date">日期时间</label><input id="timestamp-date" type="datetime-local" step="0.001"><button id="timestamp-to-epoch" type="button">换算</button></div><label class="timestamp-choice" for="timestamp-ambiguity">夏令时重复时间<select id="timestamp-ambiguity"><option value="earlier">选择较早的时刻</option><option value="later">选择较晚的时刻</option></select></label><pre id="timestamp-epoch-result" aria-live="polite"></pre><button id="timestamp-copy-epoch" type="button" disabled>复制结果</button></section></div>
 <details class="tool-notes"><summary>夏令时说明</summary><p class="timestamp-hint">所选时区的夏令时切换可能让某个本地时间出现两次，或完全不存在。重复时可选择较早或较晚的时刻；不存在时会显示错误。</p></details>
 </div>`;}

export function setupTimestamp(){
 const zone=q<HTMLSelectElement>('timestamp-zone'),number=q<HTMLInputElement>('timestamp-number'),unit=q<HTMLSelectElement>('timestamp-unit'),date=q<HTMLInputElement>('timestamp-date'),ambiguity=q<HTMLSelectElement>('timestamp-ambiguity');
 const nowDate=q<HTMLElement>('timestamp-now-date'),nowEpoch=q<HTMLElement>('timestamp-now-epoch'),dateResult=q<HTMLElement>('timestamp-date-result'),epochResult=q<HTMLElement>('timestamp-epoch-result'),copyDate=q<HTMLButtonElement>('timestamp-copy-date'),copyEpoch=q<HTMLButtonElement>('timestamp-copy-epoch');
 let timer:ReturnType<typeof setInterval>|undefined,last:'date'|'epoch'|undefined;
 const show=(target:HTMLElement,button:HTMLButtonElement,value:TimestampResult)=>{target.dataset.error='false';target.textContent=`${value.zoned}  (${value.timeZone})\nUTC: ${value.utc}\n秒: ${value.seconds}\n毫秒: ${value.milliseconds}${value.ambiguous?'\n该本地时间出现两次，已按所选规则换算。':''}`;button.disabled=false;};
 const fail=(target:HTMLElement,button:HTMLButtonElement,error:unknown)=>{target.dataset.error='true';target.textContent=error instanceof Error?error.message:String(error);button.disabled=true;};
 const refresh=()=>{try{const value=currentTimestamp(zone.value);nowDate.textContent=`${value.zoned} (${value.timeZone})`;nowEpoch.textContent=`${value.seconds} 秒 · ${value.milliseconds} 毫秒`;}catch(error){nowDate.textContent=error instanceof Error?error.message:String(error);}};
 const fromNumber=()=>{last='date';try{show(dateResult,copyDate,timestampToDate(number.value,unit.value as TimestampUnit,zone.value));}catch(error){fail(dateResult,copyDate,error);}};
 const fromDate=()=>{last='epoch';try{show(epochResult,copyEpoch,dateToTimestamp(date.value,zone.value,ambiguity.value as TimestampDisambiguation));}catch(error){fail(epochResult,copyEpoch,error);}};
 q<HTMLButtonElement>('timestamp-to-date').onclick=fromNumber;q<HTMLButtonElement>('timestamp-to-epoch').onclick=fromDate;
 q<HTMLButtonElement>('timestamp-use-now').onclick=()=>{const value=currentTimestamp(zone.value);number.value=String(value.milliseconds);unit.value='milliseconds';date.value=value.zoned.replace(' ','T');fromNumber();fromDate();};
 zone.onchange=()=>{refresh();if(last==='date')fromNumber();else if(last==='epoch')fromDate();};
 unit.onchange=()=>{if(last==='date')fromNumber();};ambiguity.onchange=()=>{if(last==='epoch')fromDate();};
 copyDate.onclick=()=>void api.copyText(dateResult.textContent||'').then(()=>toast('已复制结果')).catch(toast);
 copyEpoch.onclick=()=>void api.copyText(epochResult.textContent||'').then(()=>toast('已复制结果')).catch(toast);
 refresh();return {activate(value:boolean){if(value){refresh();if(!timer)timer=setInterval(refresh,1000);}else if(timer){clearInterval(timer);timer=undefined;}},dispose(){if(timer)clearInterval(timer);timer=undefined;}};
}
