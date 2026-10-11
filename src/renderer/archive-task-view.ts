import {api,esc,icon,q} from './ui';
import {windowControls,setupChrome} from './chrome';
import {customControls} from './controls';
import {archiveRiskRunner,ArchiveRiskNotice} from './archive-risk';
import type {ArchiveRequest,ArchiveResult} from '../shared/archive';
import './archive-task-view.css';

const name=(path:string)=>path.split(/[\\/]/).filter(Boolean).at(-1)||path;
const message=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^(?:Error:|ArchiveFailure:)\s*/,'');

export async function renderArchiveTask(){
 const data=await api.archiveTaskData();
 const manual=data.action==='create',choosing=data.action==='choose',creating=manual||data.action==='quick-zip'||data.action==='quick-7z';
 const title=creating?'创建压缩包':'解压缩',label=data.paths.length===1?name(data.paths[0]):`${data.paths.length} 个项目`;
 document.body.classList.add('archive-task-window');
 q('app').innerHTML=`<div class="archive-task-shell">
  <header class="archive-task-header drag-region"><div class="archive-task-brand">${icon('archive')}<span>${title}</span></div><div class="spacer"></div>${windowControls('archive-task')}</header>
  <main class="archive-task-main">
   <div class="archive-task-source"><span class="archive-task-source-icon">${icon(creating?'file':'archive')}</span><div><strong title="${esc(data.paths.join('\n'))}">${esc(label)}</strong><small title="${esc(data.paths[0])}">${esc(data.paths.length===1?data.paths[0]:`${data.paths.length} 个文件或文件夹`)}</small></div></div>
   ${manual?`<div id="archive-task-fields" class="archive-task-fields"><label class="archive-task-location">保存为<input id="archive-task-path" value="${esc(data.suggestedPath)}" spellcheck="false"></label><label>格式<select id="archive-task-format"><option value="zip">ZIP</option><option value="7z">7Z</option></select></label><label>密码（可选）<input id="archive-task-create-password" type="password" autocomplete="new-password" placeholder="不加密"></label></div>`:''}
   ${choosing?`<div id="archive-task-destination" class="archive-task-destination"><label for="archive-task-directory">解压到</label><div><input id="archive-task-directory" value="${esc(data.suggestedPath)}" spellcheck="false"><button id="archive-task-pick-directory" type="button">选择文件夹</button></div></div>`:''}
   <div id="archive-task-password-panel" class="archive-task-password" hidden><label>解压密码<input id="archive-task-password" type="password" autocomplete="off" placeholder="输入密码后开始解压"></label><span id="archive-task-password-note">压缩包包含加密文件</span></div>
   <div id="archive-task-progress" class="archive-task-progress" hidden><div class="archive-task-progress-line"><span id="archive-task-stage">正在准备…</span><span id="archive-task-percent"></span></div><div id="archive-task-meter" class="archive-task-meter indeterminate" role="progressbar" aria-label="任务进度" aria-valuemin="0" aria-valuemax="100"><span id="archive-task-fill"></span></div><small id="archive-task-count"></small></div>
   <div id="archive-task-feedback" class="archive-task-feedback" role="status" hidden></div>
  </main><footer class="archive-task-footer"><label class="archive-task-autoclose"><input id="archive-task-auto-close" type="checkbox"${data.closeOnComplete?' checked':''}><span>完成后自动关闭</span></label><div class="archive-task-actions"><button id="archive-task-reveal" type="button" hidden>打开所在位置</button><button id="archive-task-cancel" type="button">关闭</button><button id="archive-task-start" class="primary" type="button"${manual||choosing?'':' hidden'}>${creating?'开始压缩':'开始解压'}</button></div></footer></div>`;
 setupChrome('archive-task');customControls(q('app'));

 let active='',stopping=false,completed=false,lastPath='',closeTimer:ReturnType<typeof setTimeout>|undefined;
 const start=q<HTMLButtonElement>('archive-task-start'),cancel=q<HTMLButtonElement>('archive-task-cancel');
 const feedback=q<HTMLElement>('archive-task-feedback'),progress=q<HTMLElement>('archive-task-progress');
 const meter=q<HTMLElement>('archive-task-meter'),fill=q<HTMLElement>('archive-task-fill'),autoClose=q<HTMLInputElement>('archive-task-auto-close');
 const fields=manual?q<HTMLElement>('archive-task-fields'):null;
 const destination=choosing?q<HTMLElement>('archive-task-destination'):null;
 const passwordPanel=q<HTMLElement>('archive-task-password-panel'),password=q<HTMLInputElement>('archive-task-password');
 const reveal=q<HTMLButtonElement>('archive-task-reveal');
 const notice=(text:string,kind:'success'|'error'|'neutral'='success')=>{progress.hidden=true;feedback.hidden=false;feedback.innerHTML=`<span class="archive-task-feedback-icon">${icon(kind==='success'?'check':'info')}</span><span>${esc(text)}</span>`;feedback.classList.toggle('error',kind==='error');feedback.classList.toggle('neutral',kind==='neutral');};
 const scheduleClose=()=>{if(closeTimer)clearTimeout(closeTimer);if(completed&&autoClose.checked)closeTimer=setTimeout(()=>void api.windowAction('close'),1500);};
 autoClose.onchange=async()=>{if(closeTimer)clearTimeout(closeTimer);try{autoClose.checked=await api.archiveTaskAutoClose(autoClose.checked);scheduleClose();}catch(error){autoClose.checked=!autoClose.checked;notice(message(error),'error');}};
 reveal.onclick=()=>{if(lastPath)void api.revealFile(lastPath);};
 cancel.onclick=()=>{if(active){stopping=true;cancel.disabled=true;cancel.textContent='正在取消…';void api.archiveCancel(active).catch(error=>notice(message(error),'error'));}else void api.windowAction('close');};
 api.onArchiveProgress(value=>{if(value.id!==active)return;progress.hidden=false;const percent=value.total?Math.min(100,Math.round(value.done/value.total*100)):0;meter.classList.toggle('indeterminate',!value.total);if(value.total)meter.setAttribute('aria-valuenow',String(percent));else meter.removeAttribute('aria-valuenow');fill.style.width=value.total?`${percent}%`:'';q('archive-task-percent').textContent=value.total?`${percent}%`:'';q('archive-task-stage').textContent=value.queuePosition?`等待执行 · 第 ${value.queuePosition} 位`:value.operation==='scan'?'正在扫描':creating?'正在压缩':'正在解压';q('archive-task-count').textContent=value.total?`${value.done.toLocaleString()} / ${value.total.toLocaleString()}`:'';});
 if(manual){const format=q<HTMLSelectElement>('archive-task-format'),path=q<HTMLInputElement>('archive-task-path');format.onchange=()=>{path.value=path.value.replace(/\.(zip|7z)$/i,'')+'.'+format.value;};}
 if(choosing){const directory=q<HTMLInputElement>('archive-task-directory');q('archive-task-pick-directory').onclick=()=>void api.pickDirectory(directory.value.trim()||undefined).then(path=>{if(path)directory.value=path;}).catch(error=>notice(message(error),'error'));}
 const riskRun=archiveRiskRunner(waiting=>{if(waiting)q('archive-task-stage').textContent='等待确认解压风险';});
 const run=async()=>{
  if(active||completed)return;
  if(!creating&&!passwordPanel.hidden&&!password.value.trim()){password.focus();return;}
  let output=data.suggestedPath,format:'zip'|'7z'=data.action==='quick-7z'?'7z':'zip',createPassword='';
  if(manual){output=q<HTMLInputElement>('archive-task-path').value.trim();format=q<HTMLSelectElement>('archive-task-format').value as 'zip'|'7z';createPassword=q<HTMLInputElement>('archive-task-create-password').value;if(!output.toLowerCase().endsWith('.'+format)){notice(`压缩包位置须以 .${format} 结尾`,'error');return;}}
  const selectedDirectory=choosing?q<HTMLInputElement>('archive-task-directory').value.trim():'';
  if(choosing&&!selectedDirectory){q<HTMLInputElement>('archive-task-directory').focus();return;}
  start.hidden=true;fields?.setAttribute('hidden','');destination?.setAttribute('hidden','');feedback.hidden=true;progress.hidden=false;meter.classList.add('indeterminate');meter.removeAttribute('aria-valuenow');fill.style.width='';cancel.textContent='取消';cancel.disabled=false;stopping=false;
  for(const [index,path] of (creating?[output]:data.paths).entries()){
   active=crypto.randomUUID();q('archive-task-percent').textContent='';q('archive-task-stage').textContent=creating?'正在压缩':'正在解压';q('archive-task-count').textContent=data.paths.length>1&&!creating?`${index+1} / ${data.paths.length} 个压缩包`:'';
   try{
    const request:ArchiveRequest=creating?{operation:'create',path:output,sources:data.paths,password:createPassword}:{operation:'extract',path,parent:choosing?selectedDirectory:path.replace(/[\\/][^\\/]+$/,''),destination:choosing||data.action==='here'?'here':data.action==='smart'?'smart':'folder',conflict:data.conflict,password:password.value};
    const result=await riskRun(request,active) as ArchiveResult;
    if(result.cancelled||stopping){notice('已取消，未完成的内容不会保留。','neutral');break;}
    lastPath=result.path;
    if(index===data.paths.length-1||creating){completed=true;notice(creating?`已创建 ${name(result.path)}`:`已解压到 ${name(result.path)}`);feedback.title=result.path;reveal.hidden=false;scheduleClose();}
   }catch(error){
    const detail=error instanceof ArchiveRiskNotice?error.message:message(error);
    if(!creating&&/密码|password|encrypted|decrypt/i.test(detail)){passwordPanel.hidden=false;q('archive-task-password-note').textContent='密码不正确，请重新输入';password.focus();}
    notice(detail,'error');fields?.removeAttribute('hidden');destination?.removeAttribute('hidden');start.hidden=false;break;
   }finally{active='';}
  }
  cancel.disabled=false;cancel.textContent='关闭';
 };
 start.onclick=()=>void run();
 if(!manual){
  if(!creating){try{for(const path of data.paths){const list=await api.archiveRun({operation:'list',path,offset:0},crypto.randomUUID());if('entries'in list&&list.entries.some(entry=>entry.encrypted)){passwordPanel.hidden=false;break;}}}catch(error){if(/密码|password|encrypted/i.test(message(error)))passwordPanel.hidden=false;}}
  if(!choosing&&passwordPanel.hidden)void run();else{start.hidden=false;if(!passwordPanel.hidden)password.focus();}
 }
}
