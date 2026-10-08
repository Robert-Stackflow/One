import {api,esc,icon,toast} from './ui';
import {confirmDialog} from './dialog';
import {updateSelectOptions} from './controls';
import type {DiagnosticFile,DiagnosticRecord,LogLevel} from '../main/runtime-log';
import './logs.css';

const levelNames:Record<LogLevel,string>={debug:'调试',info:'信息',warn:'警告',error:'错误',fatal:'崩溃'};
const categoryNames:Record<string,string>={app:'应用',window:'窗口',operation:'操作',settings:'设置',file:'文件',search:'搜索',integration:'系统集成',native:'原生组件'};
const eventNames:Record<string,string>={'main-start':'应用启动','main-ready':'启动完成','main-quit':'应用退出','settings-updated':'设置已更新','window-created':'窗口已创建','window-closed':'窗口已关闭','second-instance':'再次启动 One','main-uncaught-exception':'主进程未捕获异常','main-unhandled-rejection':'主进程异步异常','child-process-gone':'子进程退出','ipc:file-tools-run':'文件任务完成','ipc:file-tools-cancel':'文件任务取消','ipc:lock-scan':'文件占用检查完成','ipc:lock-end':'结束占用进程','ipc:patch-settings':'设置已保存','ipc:settings-backup-export':'设置备份已导出','ipc:settings-backup-import':'设置备份已导入','ipc:maintenance-scan':'系统维护扫描完成','ipc:maintenance-apply':'系统维护操作完成','ipc:search-rebuild':'搜索索引重建','ipc:explorer-menu-set':'资源管理器菜单已更新'};
const eventTitle=(event:string)=>eventNames[event]||(event.startsWith('ipc:')?event.slice(4).replaceAll('-',' '):event.startsWith('renderer:')?'界面异常 · '+event.slice(9):event.startsWith('renderer-console:')?'界面控制台错误 · '+event.slice(17):event);
function formatBytes(bytes:number){return bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KB`:`${bytes} B`;}

export function logsPage(){return `
 <div class="settings-card diagnostics-card">
  <div class="diagnostics-intro"><div><h3>运行记录</h3></div><button id="diagnostics-refresh" type="button">${icon('refresh')}刷新</button></div>
  <div class="diagnostics-overview" aria-label="诊断概览"><div><strong id="diagnostics-event-count">0</strong><span>近期事件</span></div><div><strong id="diagnostics-error-count">0</strong><span>错误与崩溃</span></div><div><strong id="diagnostics-crash-count">0</strong><span>崩溃转储</span></div></div>
  <div class="diagnostics-filters"><select id="diagnostics-level" aria-label="按级别筛选"><option value="all">全部级别</option><option value="error">错误与崩溃</option><option value="warn">警告</option><option value="info">信息</option></select><select id="diagnostics-category" aria-label="按类型筛选"><option value="all">全部类型</option></select><input id="diagnostics-search" type="search" aria-label="搜索日志" placeholder="搜索事件或详情"><span id="diagnostics-visible" role="status"></span></div>
  <div id="diagnostics-events" class="diagnostics-events" aria-label="运行事件"></div>
 </div>
 <div class="settings-card diagnostics-card diagnostics-files-card"><div class="diagnostics-intro"><div><h3>日志文件与崩溃转储</h3><p>日志按大小自动轮转，崩溃文件仅保存在本机。导出前请检查文件路径、窗口标题和其他私人信息。</p></div><span id="diagnostics-summary" role="status"></span></div>
 <div class="diagnostics-actions"><label class="diagnostics-select-all"><input id="diagnostics-select-all" type="checkbox">全选</label><button id="diagnostics-export" type="button">${icon('download')}导出所选</button><button id="diagnostics-delete" type="button">${icon('trash')}删除所选</button><button id="diagnostics-open" type="button">${icon('folder')}打开文件夹</button></div><div id="diagnostics-list" class="diagnostics-list"></div></div>`;}

export function setupLogsPage(){
 let entries:DiagnosticFile[]=[],records:DiagnosticRecord[]=[];
 const list=document.querySelector<HTMLElement>('#diagnostics-list')!,events=document.querySelector<HTMLElement>('#diagnostics-events')!,summary=document.querySelector<HTMLElement>('#diagnostics-summary')!,all=document.querySelector<HTMLInputElement>('#diagnostics-select-all')!,level=document.querySelector<HTMLSelectElement>('#diagnostics-level')!,category=document.querySelector<HTMLSelectElement>('#diagnostics-category')!,search=document.querySelector<HTMLInputElement>('#diagnostics-search')!;
 const selected=()=>[...list.querySelectorAll<HTMLInputElement>('input[data-diagnostic-id]:checked')].map(input=>input.dataset.diagnosticId!);
 all.onchange=()=>{for(const input of list.querySelectorAll<HTMLInputElement>('input[data-diagnostic-id]'))input.checked=all.checked;all.indeterminate=false;};
 list.addEventListener('change',()=>{const count=selected().length;all.checked=entries.length>0&&count===entries.length;all.indeterminate=count>0&&count<entries.length;});
 const drawFiles=()=>{summary.textContent=`${entries.length} 个文件 · ${formatBytes(entries.reduce((total,item)=>total+item.size,0))}`;
  list.innerHTML=entries.length?entries.map(item=>`<label class="diagnostics-item"><input type="checkbox" data-diagnostic-id="${esc(item.id)}"><span class="diagnostics-kind">${item.kind==='crash'?'崩溃转储':'运行日志'}</span><span class="diagnostics-name" title="${esc(item.id)}">${esc(item.name)}</span><time>${new Date(item.modified).toLocaleString('zh-CN')}</time><small>${formatBytes(item.size)}</small></label>`).join(''):'<div class="diagnostics-empty">暂无诊断文件</div>';
  all.checked=false;all.indeterminate=false;
 };
 const drawEvents=()=>{const term=search.value.trim().toLowerCase();const visible=records.filter(item=>(level.value==='all'||level.value==='error'&&['error','fatal'].includes(item.level)||item.level===level.value)&&(category.value==='all'||item.category===category.value)&&(!term||[item.event,item.detail,item.category,item.source].some(value=>value.toLowerCase().includes(term))));
  document.querySelector('#diagnostics-visible')!.textContent=`显示 ${Math.min(visible.length,200)} / ${visible.length} 条`;
  events.innerHTML=visible.length?visible.slice(0,200).map(item=>`<details class="diagnostics-event" data-level="${item.level}"><summary><time>${esc(new Date(item.time).toLocaleString('zh-CN'))}</time><span class="diagnostics-level">${levelNames[item.level]}</span><span class="diagnostics-event-main"><strong>${esc(eventTitle(item.event))}</strong><small>${esc(categoryNames[item.category]||item.category)} · ${esc(item.event)}</small></span>${item.durationMs===undefined?'':`<span class="diagnostics-duration">${item.durationMs} ms</span>`}${icon('chevron-down')}</summary><div class="diagnostics-event-detail"><div>${esc(item.source)} · PID ${item.pid} · ${esc(item.file)}</div><pre>${esc(item.detail||'无补充详情')}</pre></div></details>`).join(''):'<div class="diagnostics-empty">没有符合条件的运行事件</div>';
 };
 const refresh=async()=>{[entries,records]=await Promise.all([api.diagnosticsList(),api.diagnosticsRecent()]);drawFiles();document.querySelector('#diagnostics-event-count')!.textContent=String(records.length);document.querySelector('#diagnostics-error-count')!.textContent=String(records.filter(item=>item.level==='error'||item.level==='fatal').length);document.querySelector('#diagnostics-crash-count')!.textContent=String(entries.filter(item=>item.kind==='crash').length);
  const current=category.value,keys=[...new Set(records.map(item=>item.category))].sort();updateSelectOptions(category,[{value:'all',label:'全部类型'},...keys.map(key=>({value:key,label:categoryNames[key]||key}))]);category.value=keys.includes(current)?current:'all';drawEvents();};
 for(const input of [level,category,search])input.addEventListener(input===search?'input':'change',drawEvents);
 document.querySelector<HTMLButtonElement>('#diagnostics-refresh')!.onclick=()=>void refresh().catch(toast);
 document.querySelector<HTMLButtonElement>('#diagnostics-open')!.onclick=()=>void api.diagnosticsOpen().then(error=>{if(error)toast(error);}).catch(toast);
 document.querySelector<HTMLButtonElement>('#diagnostics-export')!.onclick=()=>void(async()=>{const ids=selected();if(!ids.length){toast('请先选择日志或崩溃文件');return;}const path=await api.diagnosticsExport(ids);if(path)toast(`已导出到 ${path}`);})().catch(toast);
 document.querySelector<HTMLButtonElement>('#diagnostics-delete')!.onclick=()=>void(async()=>{const ids=selected();if(!ids.length){toast('请先选择文件');return;}if(!await confirmDialog({title:'删除诊断文件',message:`删除所选的 ${ids.length} 个本地诊断文件？`,confirm:'删除',danger:true}))return;await api.diagnosticsDelete(ids);await refresh();})().catch(toast);
 return{refresh};
}
