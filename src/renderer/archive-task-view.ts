import {api,esc,icon,q} from './ui';
import {windowControls,setupChrome} from './chrome';
import {customControls} from './controls';
import {archiveRiskRunner,ArchiveRiskNotice} from './archive-risk';
import type {ArchiveRequest,ArchiveResult} from '../shared/archive';
import {archiveFormatOptions,archiveVolumeOptions,archiveVolumeBytes,archiveSizeText} from './archive-create-options';
import {archiveLevelOptions,archiveZipMethodOptions,archiveZipEncryptionOptions,archiveSevenMethodOptions,archiveSolidOptions} from './archive-settings';
import {archiveFormats} from '../shared/archive-preferences';
import './archive-task-view.css';

const name=(path:string)=>path.split(/[\\/]/).filter(Boolean).at(-1)||path;
const sizeText=archiveSizeText;
const message=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^(?:Error:|ArchiveFailure:)\s*/,'');

export async function renderArchiveTask(){
 const data=await api.archiveTaskData();
 const manual=data.action==='create',choosing=data.action==='choose',creating=manual||data.action.startsWith('quick-');
 const title=creating?'创建压缩包':'解压缩',label=data.paths.length===1?name(data.paths[0]):`${data.paths.length} 个项目`;
 document.body.classList.add('archive-task-window');
 q('app').innerHTML=`<div class="archive-task-shell">
  <header class="archive-task-header drag-region"><div class="archive-task-brand">${icon('archive')}<span>${title}</span></div><div class="spacer"></div>${windowControls('archive-task')}</header>
  <main class="archive-task-main">
   ${manual?'':`<div class="archive-task-source"><span class="archive-task-source-icon">${icon(creating?'file':'archive')}</span><div><strong title="${esc(data.paths.join('\n'))}">${esc(label)}</strong><small title="${esc(data.paths[0])}">${esc(data.paths.length===1?data.paths[0]:`${data.paths.length} 个文件或文件夹`)}</small></div></div>`}
   ${manual?`<div id="archive-task-fields" class="archive-create-layout">
    <section class="archive-create-sources"><div class="archive-create-heading"><div><h2>添加到压缩包</h2><small id="archive-task-source-count"></small></div><div class="archive-create-source-actions"><button id="archive-task-add-file" type="button">${icon('file')}添加文件</button><button id="archive-task-add-folder" type="button">${icon('folder')}添加文件夹</button></div></div><div class="archive-create-columns"><span>文件路径</span><span>大小</span><span></span></div><div id="archive-task-source-list" class="archive-create-list" role="list"></div><div id="archive-task-source-total" class="archive-create-total" role="status"></div></section>
    <section class="archive-create-settings"><h2>压缩设置</h2><label class="archive-task-location">保存为<input id="archive-task-path" value="${esc(data.suggestedPath)}" spellcheck="false"></label><div class="archive-create-two"><label>格式<select id="archive-task-format">${archiveFormatOptions}</select></label><label>密码（可选）<input id="archive-task-create-password" type="password" autocomplete="new-password" placeholder="不加密"></label></div><p id="archive-task-format-note" class="archive-create-note" hidden></p>
     <details id="archive-task-advanced" class="archive-create-advanced"><summary>高级选项 ${icon('chevron-down')}</summary><div class="archive-create-advanced-body"><div class="archive-create-two"><label>压缩等级<select id="archive-task-level">${archiveLevelOptions()}</select></label><label>分卷大小<select id="archive-task-volume">${archiveVolumeOptions}</select></label></div><label id="archive-task-volume-custom-row" hidden>自定义分卷大小（MB）<input id="archive-task-volume-custom" type="number" min="1" max="65536" step="1" placeholder="1–65536"></label><div id="archive-task-zip-options" class="archive-create-two"><label>ZIP 压缩方法<select id="archive-task-zip-method">${archiveZipMethodOptions}</select></label><label>加密算法<select id="archive-task-zip-encryption">${archiveZipEncryptionOptions}</select></label></div><div id="archive-task-seven-options" class="archive-create-two" hidden><label>7Z 压缩方法<select id="archive-task-seven-method">${archiveSevenMethodOptions}</select></label><label>固实块大小<select id="archive-task-seven-solid">${archiveSolidOptions()}</select></label></div><p id="archive-task-advanced-note" class="archive-create-note">分卷与密码适用于 ZIP / 7Z。</p></div></details>
    </section>
   </div>`:''}
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
 const createSources=[...data.paths];
 if(manual){
  const format=q<HTMLSelectElement>('archive-task-format'),path=q<HTMLInputElement>('archive-task-path'),volume=q<HTMLSelectElement>('archive-task-volume');
  const sizes=new Map<string,number|null|undefined>();
  const renderSources=()=>{q('archive-task-source-count').textContent=`${createSources.length} 个项目`;q('archive-task-source-list').innerHTML=createSources.length?createSources.map((source,index)=>{const bytes=sizes.get(source.toLowerCase());return `<div class="archive-create-item" role="listitem"><div class="archive-create-item-path"><span class="archive-create-item-icon">${icon('file')}</span><div><strong title="${esc(source)}">${esc(name(source))}</strong><small title="${esc(source)}">${esc(source)}</small></div></div><span class="archive-create-item-size">${bytes===undefined?'计算中…':bytes===null?'无法读取':sizeText(bytes)}</span><button type="button" data-remove-source="${index}" aria-label="移除 ${esc(name(source))}" title="移除">${icon('close')}</button></div>`;}).join(''):'<div class="archive-create-empty">还没有添加文件或文件夹</div>';const values=createSources.map(source=>sizes.get(source.toLowerCase())),known=values.filter((value):value is number=>typeof value==='number'),total=known.reduce((sum,value)=>sum+value,0);q('archive-task-source-total').textContent=values.some(value=>value===undefined)?`总大小 · 正在计算${known.length?`（已知 ${sizeText(total)}）`:''}`:values.some(value=>value===null)?`总大小 · 部分来源无法读取（已知 ${sizeText(total)}）`:`总大小 · ${sizeText(total)}`;};
  const readSize=(source:string)=>{const key=source.toLowerCase();if(sizes.has(key))return;sizes.set(key,undefined);void api.archiveSourceSize(source).then(bytes=>sizes.set(key,bytes)).catch(()=>sizes.set(key,null)).finally(renderSources);};
  createSources.forEach(readSize);
  renderSources();
  q('archive-task-source-list').onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-remove-source]');if(!button)return;createSources.splice(Number(button.dataset.removeSource),1);renderSources();};
  const addSource=(source:string)=>{if(!createSources.some(item=>item.toLowerCase()===source.toLowerCase())){createSources.push(source);readSize(source);}renderSources();};
  q('archive-task-add-file').onclick=()=>void api.pickFile().then(source=>{if(source)addSource(source);}).catch(error=>notice(message(error),'error'));
  q('archive-task-add-folder').onclick=()=>void api.pickDirectory().then(source=>{if(source)addSource(source);}).catch(error=>notice(message(error),'error'));
  const syncFormat=()=>{const value=format.value,encryptable=value==='zip'||value==='7z',single=value==='gz'||value==='xz';path.value=path.value.replace(/\.(?:tar\.gz|tar\.xz|tgz|txz|zip|7z|tar|gz|xz)$/i,'')+'.'+value;q<HTMLInputElement>('archive-task-create-password').disabled=!encryptable;volume.disabled=!encryptable;if(!encryptable){q<HTMLInputElement>('archive-task-create-password').value='';volume.value='none';}q('archive-task-volume-custom-row').hidden=!encryptable||volume.value!=='custom';q<HTMLSelectElement>('archive-task-level').disabled=value==='tar';q('archive-task-zip-options').hidden=value!=='zip';q('archive-task-seven-options').hidden=value!=='7z';const note=q('archive-task-format-note');note.hidden=!single;note.textContent=single?'GZ 和 XZ 只支持压缩单个文件；文件夹请选 TAR.GZ 或 TAR.XZ。':'';q('archive-task-advanced-note').textContent=encryptable?'分卷与密码适用于 ZIP / 7Z。':value==='tar'?'TAR 仅打包，不进行压缩。':'此格式不支持密码和分卷。';};
  format.onchange=syncFormat;
  volume.onchange=()=>{q('archive-task-volume-custom-row').hidden=volume.value!=='custom';};
  void api.settings().then(settings=>{format.value=settings.archive.defaultFormat;q<HTMLSelectElement>('archive-task-level').value=String(settings.archive.compressionLevel);q<HTMLSelectElement>('archive-task-zip-method').value=settings.archive.zipMethod;q<HTMLSelectElement>('archive-task-zip-encryption').value=settings.archive.zipEncryption;q<HTMLSelectElement>('archive-task-seven-method').value=settings.archive.sevenMethod;q<HTMLSelectElement>('archive-task-seven-solid').value=String(settings.archive.sevenSolid);syncFormat();}).catch(()=>{});
 }
 if(choosing){const directory=q<HTMLInputElement>('archive-task-directory');q('archive-task-pick-directory').onclick=()=>void api.pickDirectory(directory.value.trim()||undefined).then(path=>{if(path)directory.value=path;}).catch(error=>notice(message(error),'error'));}
 const riskRun=archiveRiskRunner(waiting=>{if(waiting)q('archive-task-stage').textContent='等待确认解压风险';});
 const run=async()=>{
  if(active||completed)return;
  if(!creating&&!passwordPanel.hidden&&!password.value.trim()){password.focus();return;}
  let output=data.suggestedPath,format:string=data.action.startsWith('quick-')?data.action.slice(6).replaceAll('-','.'):'zip',createPassword='',volumeBytes=0,level:number|undefined;
  if(manual){
   if(!createSources.length){notice('请先添加文件或文件夹','error');return;}
   output=q<HTMLInputElement>('archive-task-path').value.trim();format=q<HTMLSelectElement>('archive-task-format').value;createPassword=q<HTMLInputElement>('archive-task-create-password').value;
   if(!archiveFormats.some(value=>value===format)){notice('不支持该压缩格式','error');return;}
   const aliases=format==='tar.gz'?['tar.gz','tgz']:format==='tar.xz'?['tar.xz','txz']:[format];if(!aliases.some(value=>output.toLowerCase().endsWith('.'+value))){notice(`压缩包位置须以 ${aliases.map(value=>'.'+value).join(' 或 ')} 结尾`,'error');return;}
   try{volumeBytes=archiveVolumeBytes(q<HTMLSelectElement>('archive-task-volume').value,q<HTMLInputElement>('archive-task-volume-custom').value);}catch(error){notice(message(error),'error');return;}
   level=format==='tar'?0:Number(q<HTMLSelectElement>('archive-task-level').value);
  }
  const selectedDirectory=choosing?q<HTMLInputElement>('archive-task-directory').value.trim():'';
  if(choosing&&!selectedDirectory){q<HTMLInputElement>('archive-task-directory').focus();return;}
  start.hidden=true;fields?.setAttribute('hidden','');destination?.setAttribute('hidden','');feedback.hidden=true;progress.hidden=false;meter.classList.add('indeterminate');meter.removeAttribute('aria-valuenow');fill.style.width='';cancel.textContent='取消';cancel.disabled=false;stopping=false;
  for(const [index,path] of (creating?[output]:data.paths).entries()){
   active=crypto.randomUUID();q('archive-task-percent').textContent='';q('archive-task-stage').textContent=creating?'正在压缩':'正在解压';q('archive-task-count').textContent=data.paths.length>1&&!creating?`${index+1} / ${data.paths.length} 个压缩包`:'';
   try{
    const request:ArchiveRequest=creating?{operation:'create',path:output,sources:manual?createSources:data.paths,password:createPassword,...(manual?{level,volumeBytes,...(format==='zip'?{zipMethod:q<HTMLSelectElement>('archive-task-zip-method').value as 'deflate'|'xz',zipEncryption:q<HTMLSelectElement>('archive-task-zip-encryption').value as 'aes256'|'zipcrypto'}:{}),...(format==='7z'?{sevenMethod:q<HTMLSelectElement>('archive-task-seven-method').value as 'lzma'|'lzma2',sevenSolid:(['off','solid'].includes(q<HTMLSelectElement>('archive-task-seven-solid').value)?q<HTMLSelectElement>('archive-task-seven-solid').value:Number(q<HTMLSelectElement>('archive-task-seven-solid').value)) as import('../shared/archive-compression').ArchiveCompression['sevenSolid']}:{} )}:{})}:{operation:'extract',path,parent:choosing?selectedDirectory:path.replace(/[\\/][^\\/]+$/,''),destination:choosing||data.action==='here'?'here':data.action==='smart'?'smart':'folder',conflict:data.conflict,password:password.value};
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
