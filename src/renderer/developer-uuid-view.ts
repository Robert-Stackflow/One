import './developer-uuid.css';
import {api,q,toast,errorMessage} from './ui';
import {generateUuids,type UuidFormat} from '../shared/uuid-tool';

export function developerUuidPage(){return `<div class="developer-uuid-page"><header class="developer-uuid-heading"><h2>UUID 生成</h2><p>使用安全随机数生成 UUID v4，可一次生成 1–1000 个。</p></header>
 <div class="developer-uuid-layout"><section class="settings-card developer-uuid-panel" aria-label="生成设置"><h3>生成设置</h3>
 <div class="developer-uuid-options"><label>数量<input id="developer-uuid-count" type="number" min="1" max="1000" step="1" value="1"></label><label>格式<select id="developer-uuid-format"><option value="standard">标准（带连字符）</option><option value="compact">紧凑（无连字符）</option><option value="braces">花括号</option></select></label><label class="developer-uuid-case"><input id="developer-uuid-uppercase" type="checkbox">大写字母</label></div>
 <div class="developer-uuid-actions"><button id="developer-uuid-generate" type="button">生成 UUID</button><button id="developer-uuid-copy" type="button" disabled>复制全部</button></div><span id="developer-uuid-status" role="status" aria-live="polite"></span></section>
 <section class="settings-card developer-uuid-panel" aria-label="生成结果"><h3>生成结果</h3><textarea id="developer-uuid-output" class="developer-uuid-output" readonly spellcheck="false" aria-label="生成的 UUID" placeholder="生成后在这里查看和复制 UUID"></textarea></section></div></div>`;}

export function setupDeveloperUuid(){
 const count=q<HTMLInputElement>('developer-uuid-count'),format=q<HTMLSelectElement>('developer-uuid-format'),uppercase=q<HTMLInputElement>('developer-uuid-uppercase'),output=q<HTMLTextAreaElement>('developer-uuid-output');
 const generate=q<HTMLButtonElement>('developer-uuid-generate'),copy=q<HTMLButtonElement>('developer-uuid-copy'),status=q<HTMLElement>('developer-uuid-status');
 generate.onclick=()=>{try{const values=generateUuids(Number(count.value),format.value as UuidFormat,uppercase.checked);output.value=values.join('\n');status.textContent=`已生成 ${values.length} 个 UUID v4`;copy.disabled=false;}catch(error){status.textContent=errorMessage(error);}};
 copy.onclick=()=>void api.copyText(output.value).then(()=>toast('已复制 UUID')).catch(toast);
 return {activate(_value:boolean){},dispose(){}};
}
