import {api,esc,icon} from './ui';
import {installFileDropOverlay} from './file-drop-overlay';
import {archiveScanText} from '../shared/archive-scan';
import {archivePreferences,archiveLevelOptions,archiveThreadOptions,archiveSolidOptions,archiveZipMethodOptions,archiveZipEncryptionOptions,archiveSevenMethodOptions} from './archive-settings';
import {archiveEditorMarkup,archiveEditPreviewMarkup,setupArchiveEditor} from './archive-editor';
import {archiveBrowserMarkup,setupArchiveBrowser} from './archive-browser';
import type {ArchiveListing,ArchiveEncoding,ArchivePasswordEncoding,ArchiveProgress,ArchiveConflict,ArchiveResult} from '../shared/archive';
import {isArchivePath,type ArchiveOpenAction} from '../shared/archive-actions';
import './archive-view.css';
import {showArchiveRecovery} from './archive-recovery';
import {showArchiveEditSessions} from './archive-edit-sessions';
import {archiveRiskRunner,ArchiveRiskNotice} from './archive-risk';
import {showArchiveDetails} from './archive-details';
import {closeDialog,dialogMarkup,openDialog} from './dialog';

const passwordEncodingOptions=()=>'<option value="65001">UTF-8（默认）</option><option value="0">Windows 系统编码</option><option value="936">GBK / CP936</option><option value="932">Shift JIS / CP932</option><option value="950">Big5 / CP950</option><option value="437">CP437</option>';

export function archivePage(){return `<div class="archive-workspace">
 <div class="archive-toolbar"><div class="archive-mode tabs" role="tablist" aria-label="压缩与解压"><button type="button" data-archive-mode="create" class="selected" aria-selected="true">创建压缩包</button><button type="button" data-archive-mode="browse" aria-selected="false">浏览与解压</button></div><div class="archive-toolbar-actions"><button id="archive-edit-sessions-open" class="quiet" type="button">外部编辑</button><button id="archive-recovery-open" class="quiet" type="button">${icon('history')}恢复资料</button><label class="archive-open-completed"><input id="archive-open-completed" type="checkbox">完成后打开文件夹</label></div></div>
 <div class="archive-work-area">
 <section class="archive-layout archive-create-layout archive-explorer" data-archive-pane="create">
  <div class="archive-panel archive-source-panel"><div class="archive-card-heading"><div><h2>压缩内容</h2><span id="archive-source-count">尚未添加内容</span></div><div class="archive-heading-actions"><button id="archive-add-file" type="button">${icon('plus')}添加文件</button><button id="archive-add-folder" type="button">${icon('folder')}添加文件夹</button><button id="archive-sources-clear" class="icon-button quiet" type="button" aria-label="清空待压缩内容" title="清空" hidden>${icon('trash')}</button></div></div>
   <div id="archive-source-items" class="archive-source-items" aria-label="待压缩内容"></div>
   <div id="archive-source-empty" class="archive-drop-hint">${icon('archive')}<strong>拖入文件或文件夹</strong></div>
   <div class="archive-source-footer"><button id="archive-sources-open" class="quiet" type="button">${icon('text')}粘贴或编辑路径</button></div>
  </div>
  <aside class="archive-panel archive-rail" aria-label="创建设置"><h2>保存压缩包</h2>
   <label class="archive-field">压缩格式<select id="archive-format"><option value="zip">ZIP</option><option value="7z">7Z</option><option value="tar">TAR</option><option value="tar.gz">TAR.GZ</option><option value="tar.xz">TAR.XZ</option><option value="gz">GZ（单文件）</option><option value="xz">XZ（单文件）</option></select></label>
   <div class="archive-field"><label for="archive-target">保存位置</label><div class="archive-destination-input"><input id="archive-target" placeholder="选择保存位置或输入 .zip 路径"><button id="archive-target-pick" type="button" class="icon-button quiet" aria-label="选择压缩包保存位置" title="选择文件夹">${icon('folder')}</button></div></div>
   <div class="archive-options-link"><button id="archive-advanced-open" type="button"><span><span>压缩选项</span><small id="archive-advanced-summary">密码、分卷、压缩等级</small></span>${icon('chevron')}</button></div>
   ${dialogMarkup({id:'archive-advanced-dialog',title:'压缩选项',className:'archive-options-dialog',body:`<div class="archive-advanced-body">
    <label class="archive-field">加密密码<input id="archive-create-password" type="password" autocomplete="new-password" placeholder="留空不加密"></label>
    <div id="archive-create-password-encoding-row"><label class="archive-field">ZIP 密码编码<select id="archive-create-password-encoding">${passwordEncodingOptions()}</select></label><p>与 Windows 版 7-Zip 交换中文密码 ZIP 时，可选系统编码；双方系统代码页须一致。</p></div>
    <div id="archive-zip-compression" class="archive-fields"><label>ZIP 压缩方法<select id="archive-zip-method">${archiveZipMethodOptions}</select></label><label>加密算法<select id="archive-zip-encryption">${archiveZipEncryptionOptions}</select></label></div>
    <p id="archive-zip-compatibility">Deflate 兼容性更广；XZ 需要接收软件支持。ZipCrypto 仅用于旧软件兼容。</p>
    <div id="archive-seven-compression" class="archive-fields" hidden><label>7Z 压缩方法<select id="archive-seven-method">${archiveSevenMethodOptions}</select></label><label>固实块大小<select id="archive-seven-solid">${archiveSolidOptions()}</select></label></div>
    <label class="archive-field">分卷大小（MB）<input id="archive-volume" type="number" min="1" max="65536" step="1" placeholder="留空不分卷"></label>
    <label class="archive-field">压缩等级<select id="archive-level">${archiveLevelOptions()}</select></label>
    <div class="archive-fields"><label>线程数<select id="archive-threads">${archiveThreadOptions()}</select></label><label>内存上限（MB）<input id="archive-memory" type="number" min="128" max="8192" step="1" value="1024"></label></div>
    <p>这些选项仅用于本次任务。ZIP 可并行压缩多个文件；GZ 使用单线程；TAR 仅打包。密码和分卷适用于 ZIP / 7Z。</p>
   </div>`,actions:'<button id="archive-advanced-done" class="primary" type="button">完成</button>'})}
   <div class="archive-rail-action"><div id="archive-status" class="archive-feedback" role="status" hidden><span id="archive-status-icon" class="archive-feedback-icon">${icon('info')}</span><div class="archive-feedback-copy"><span id="archive-status-text"></span><details id="archive-status-details" hidden><summary>错误详情</summary><pre id="archive-status-detail"></pre></details></div><button id="archive-feedback-dismiss" class="icon-button quiet" type="button" aria-label="关闭任务结果">${icon('close')}</button></div><button id="archive-create" class="primary" type="button">${icon('archive')}创建压缩包</button></div>
  </aside>
 </section>
 <section class="archive-browse-pane" data-archive-pane="browse" hidden>
  <div class="archive-explorer">
  <div class="archive-open-bar"><label for="archive-source">压缩包</label><input id="archive-source" placeholder="选择或拖入压缩包，也可以粘贴完整路径"><button id="archive-open-pick" type="button">${icon('folder')}选择文件</button><button id="archive-open" type="button">打开</button></div>
  <div class="archive-layout archive-browse-layout">
   <div class="archive-panel archive-content-panel">
    ${dialogMarkup({id:'archive-comment-section',title:'压缩包备注',className:'archive-options-dialog',body:'<div id="archive-comment" class="archive-comment"></div>',actions:'<button id="archive-comment-done" class="primary" type="button">关闭</button>'})}
    ${archiveBrowserMarkup(archiveEditorMarkup(),'<div class="archive-content-title"><h2>包内文件</h2><strong id="archive-count"></strong></div>',`<div class="archive-menu-section"><button id="archive-test" type="button">${icon('check')}测试完整性</button><button id="archive-comment-open" type="button" hidden>${icon('text')}查看备注</button></div>`,archiveEditPreviewMarkup())}
   </div>
   <aside class="archive-panel archive-rail" aria-label="解压设置"><h2>解压到</h2>
    <div class="archive-field"><label for="archive-parent">目标目录</label><div class="archive-destination-input"><input id="archive-parent" placeholder="选择目标文件夹"><button id="archive-parent-pick" type="button" class="icon-button quiet" aria-label="选择解压目标文件夹" title="选择文件夹">${icon('folder')}</button></div></div>
    <label class="archive-field">解压方式<select id="archive-destination-mode"><option value="folder">解压到同名文件夹</option><option value="smart">智能解压</option><option value="here">解压至此</option></select></label>
    <p id="archive-destination-hint" class="archive-field-hint">创建同名文件夹，已有内容不会被覆盖。</p>
    <div class="archive-options-link"><button id="archive-decode-open" type="button"><span><span>密码与编码</span><small id="archive-decode-summary">未设置密码 · 自动识别文件名</small></span>${icon('chevron')}</button></div>
    ${dialogMarkup({id:'archive-decode-dialog',title:'密码与文件名编码',className:'archive-options-dialog',body:`<label class="archive-field">解压密码<input id="archive-password" type="password" autocomplete="off" placeholder="未加密的压缩包可留空"></label>
    <div id="archive-password-encoding-row" hidden><label class="archive-field">ZIP 密码编码<select id="archive-password-encoding">${passwordEncodingOptions()}</select></label><p>密码正确却无法解密时，尝试创建压缩包时使用的编码。Windows 版 7-Zip 可尝试系统编码；与文件名编码无关。</p></div>
    <label class="archive-field">旧文件名编码<select id="archive-encoding"><option value="0">自动</option><option value="437">CP437</option><option value="936">GBK / CP936</option><option value="932">Shift JIS / CP932</option><option value="950">Big5 / CP950</option><option value="65001">UTF-8</option></select></label><p>文件名显示异常时可手动选择编码。应用后会重新读取当前压缩包。</p>
    <label id="archive-conflict-row" class="archive-field" hidden>解压至此 · 同名文件<select id="archive-conflict"><option value="rename">自动重命名 · 保留原文件</option><option value="skip">跳过</option><option value="replace">替换文件</option></select></label>`,actions:'<button id="archive-decode-done" class="primary" type="button">应用</button>'})}
    <div class="archive-rail-action"><button id="archive-extract-all" class="primary" type="button">${icon('download')}全部解压</button><button id="archive-extract-selected" type="button">解压选中项</button></div>
   </aside>
  </div>
  </div>
 </section>
 ${dialogMarkup({id:'archive-sources-dialog',title:'粘贴或编辑文件路径',className:'archive-options-dialog archive-sources-dialog',body:'<label class="archive-field">每行一个完整路径<textarea id="archive-sources" rows="8" placeholder="例如 D:\\文档\\资料"></textarea></label>',actions:'<button id="archive-sources-done" class="primary" type="button">完成</button>'})}
 ${dialogMarkup({id:'archive-result-dialog',title:'完整性校验',className:'archive-options-dialog archive-result-dialog',body:'<div id="archive-result-icon" class="archive-result-icon"></div><h3 id="archive-result-title"></h3><p id="archive-result-file"></p><div id="archive-result-message"></div>',actions:'<button id="archive-result-done" type="button" class="primary">完成</button>'})}
 <section id="archive-batch" class="archive-panel archive-batch" hidden aria-label="批量处理结果"><div class="archive-panel-title"><h2>批量处理结果</h2><span id="archive-batch-summary" aria-live="polite"></span></div><div id="archive-batch-list"></div></section>
 <div id="archive-loading" class="archive-loading" role="region" aria-label="归档任务进度" hidden><div class="archive-loading-card"><span class="archive-loading-spinner" aria-hidden="true"></span><h3 id="archive-loading-title" role="status" aria-live="polite">正在处理…</h3><span id="archive-loading-source" class="archive-loading-source"></span><progress id="archive-loading-progress" aria-label="任务进度"></progress><span id="archive-loading-count" class="archive-loading-count"></span><button id="archive-cancel" type="button">${icon('stop')}停止</button><span id="archive-loading-hint" class="archive-loading-hint">停止后会清理本次未完成的内容</span></div></div>
 </div></div>`;}

export function setupArchiveView(){
 const root=document.querySelector<HTMLElement>('#page-archive')!;
 const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 find('#archive-recovery-open').onclick=()=>showArchiveRecovery();
 find('#archive-edit-sessions-open').onclick=()=>showArchiveEditSessions(async archive=>{if(listing?.path===archive)await load();});
 const showOptions=(id:string)=>openDialog(find<HTMLDialogElement>(id));
 const finishOptions=(id:string)=>closeDialog(find<HTMLDialogElement>(id));
 find('#archive-advanced-open').onclick=()=>showOptions('#archive-advanced-dialog');
 find('#archive-advanced-done').onclick=()=>void finishOptions('#archive-advanced-dialog');
 find('#archive-sources-open').onclick=()=>showOptions('#archive-sources-dialog');
 find('#archive-sources-done').onclick=()=>void finishOptions('#archive-sources-dialog');
 find('#archive-decode-open').onclick=()=>showOptions('#archive-decode-dialog');
 find('#archive-comment-open').onclick=()=>showOptions('#archive-comment-section');
 find('#archive-comment-done').onclick=()=>void finishOptions('#archive-comment-section');
 find('#archive-result-done').onclick=()=>void finishOptions('#archive-result-dialog');
 const field=(selector:string)=>{const input=find<HTMLInputElement>(selector);return input.type==='password'?input.value:input.value.trim();};
 const readPasswordEncoding=():ArchivePasswordEncoding=>/\.zip$/i.test(field('#archive-source'))?Number(field('#archive-password-encoding')) as ArchivePasswordEncoding:65001;
 const syncPasswordEncoding=()=>{find('#archive-password-encoding-row').hidden=!/\.zip$/i.test(field('#archive-source'));};
 const decodeSummary=()=>{find('#archive-decode-summary').textContent=`${field('#archive-password')?'已设置密码':'未设置密码'} · ${field('#archive-encoding')==='0'?'自动识别文件名':'指定文件名编码'}`;};
 let mode:'create'|'browse'='create',listing:ArchiveListing|undefined,busy=false,taskId='',creationFormat='zip',selectionCount=0,stopping=false,cancelAllowed=true;
 type BatchItem={path:string;state:'待处理'|'正在处理'|'已完成'|'失败'|'已取消'|'待打开'|'已读取';detail:string};
 let batchActive=false,batchCancelled=false,batchItems:BatchItem[]=[],batchAction:ArchiveOpenAction='extract',lastResult:ArchiveResult|undefined;
 const openCompleted=find<HTMLInputElement>('#archive-open-completed');
 const fillOptions=(value:Awaited<ReturnType<typeof archivePreferences>>)=>{find<HTMLSelectElement>('#archive-level').value=String(value.compressionLevel);find<HTMLInputElement>('#archive-threads').value=value.autoThreads?'0':String(value.threads);find<HTMLSelectElement>('#archive-zip-method').value=value.zipMethod;find<HTMLSelectElement>('#archive-zip-encryption').value=value.zipEncryption;find<HTMLSelectElement>('#archive-seven-method').value=value.sevenMethod;find<HTMLSelectElement>('#archive-seven-solid').value=String(value.sevenSolid);find<HTMLInputElement>('#archive-memory').value=String(value.memoryMiB);};
 const preferencesReady=archivePreferences().then(value=>{openCompleted.checked=value.openCompleted;fillOptions(value);find<HTMLSelectElement>('#archive-conflict').value=value.conflict;find<HTMLSelectElement>('#archive-format').value=value.defaultFormat;find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));});
 void preferencesReady.catch(error=>statusError(error));
 api.onArchivePreferences(value=>{openCompleted.checked=value.openCompleted;if(!busy&&!field('#archive-target')&&!field('#archive-sources')){fillOptions(value);find<HTMLSelectElement>('#archive-format').value=value.defaultFormat;find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));}});
 openCompleted.onchange=()=>{void api.patchSettings({archive:{openCompleted:openCompleted.checked}}).catch(error=>{statusError(error);void archivePreferences().then(value=>openCompleted.checked=value.openCompleted).catch(()=>{});});};
 const loading=(message:string,cancellable=true,done=0,total=0)=>{
  const layer=find('#archive-loading');layer.hidden=false;find('.archive-work-area').setAttribute('aria-busy','true');find('#archive-status').hidden=true;
  find('#archive-status-text').textContent=message;find('#archive-loading-title').textContent=stopping?'正在停止…':message.split(' · ')[0];
  const source=field(mode==='create'?'#archive-target':'#archive-source');find('#archive-loading-source').textContent=source.split(/[\\/]/).pop()||'';
  const meter=find<HTMLProgressElement>('#archive-loading-progress');if(total>0&&Number.isFinite(total)&&Number.isFinite(done)&&done>=0){meter.max=total;meter.value=Math.min(done,total);}else meter.removeAttribute('value');
  find('#archive-loading-count').textContent=total?`${done.toLocaleString()} / ${total.toLocaleString()}`:message.includes(' · ')?message.split(' · ').slice(1).join(' · '):'';
  cancelAllowed=cancellable;const cancel=find<HTMLButtonElement>('#archive-cancel');cancel.hidden=!cancellable;cancel.disabled=stopping;cancel.innerHTML=stopping?'正在停止…':`${icon('stop')}停止`;
  find('#archive-loading-hint').textContent=stopping?'正在结束任务，请稍候':cancellable?message.includes('修改')?'停止后保留原包；需要检查的资料会列在“恢复资料”中':'停止后会清理本次未完成的内容':message.includes('传输')||message.includes('拖到')?'拖到目标文件夹后松开鼠标；按 Esc 取消':'正在完成最终保存，请稍候';
 };
 const status=(message:string,running=false,detail='')=>{if(running){loading(message);return;}const node=find('#archive-status'),state=detail?'error':/^(已创建|已解压|校验完成|已保存)/.test(message)?'success':'info';
  node.hidden=/^已读取/.test(message);node.dataset.state=state;node.setAttribute('role',detail?'alert':'status');find('#archive-status-icon').innerHTML=icon(state==='success'?'check':'info');find('#archive-status-text').textContent=message;
  const details=find<HTMLDetailsElement>('#archive-status-details');details.hidden=!detail;details.open=false;find('#archive-status-detail').textContent=detail;
 };
 find('#archive-feedback-dismiss').onclick=()=>find('#archive-status').hidden=true;
 const statusError=(error:unknown)=>{const detail=error instanceof Error?error.message:String(error),message=detail.replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^(?:Error|ArchiveFailure|TypeError):\s*/,'');status(message.length>200?message.slice(0,200)+'…':message,false,detail);};
 const sourcePaths=()=>field('#archive-sources').split(/\r?\n/).map(path=>path.trim()).filter(Boolean);
 const updateExtractActions=()=>{find<HTMLButtonElement>('#archive-extract-all').disabled=busy||batchActive||!listing;const selected=find<HTMLButtonElement>('#archive-extract-selected');selected.disabled=busy||batchActive||!listing||!selectionCount;selected.textContent=selectionCount?`解压选中项 · ${selectionCount.toLocaleString()}`:'解压选中项';};
 const refreshSources=()=>{const paths=sourcePaths();find('#archive-source-count').textContent=paths.length?`${paths.length.toLocaleString()} 个文件或文件夹`:'尚未添加内容';find('#archive-source-empty').hidden=!!paths.length;find('#archive-sources-clear').hidden=!paths.length;find('#archive-source-items').innerHTML=paths.slice(0,100).map((path,index)=>`<div class="archive-source-item">${icon('file')}<div><strong title="${esc(path)}">${esc(path.split(/[\\/]/).filter(Boolean).pop()||path)}</strong><small title="${esc(path)}">${esc(path)}</small></div><button type="button" class="icon-button quiet" data-archive-source-remove="${index}" aria-label="移除 ${esc(path)}"${busy||batchActive?' disabled':''}>${icon('close')}</button></div>`).join('')+(paths.length>100?`<div class="archive-source-rest">另有 ${(paths.length-100).toLocaleString()} 项，全部路径可在下方编辑。</div>`:'');};
 find<HTMLTextAreaElement>('#archive-sources').oninput=refreshSources;
 find('#archive-sources-clear').onclick=()=>{if(busy||batchActive)return;find<HTMLTextAreaElement>('#archive-sources').value='';refreshSources();};
 find('#archive-source-items').onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-archive-source-remove]');if(!button||busy||batchActive)return;const paths=sourcePaths(),index=Number(button.dataset.archiveSourceRemove);paths.splice(index,1);find<HTMLTextAreaElement>('#archive-sources').value=paths.join('\n');refreshSources();(root.querySelector<HTMLButtonElement>(`[data-archive-source-remove="${Math.min(index,paths.length-1)}"]`)||find('#archive-add-file')).focus();};
 const setBusy=(value:boolean)=>{busy=value;const blocked=value||batchActive;for(const button of root.querySelectorAll<HTMLButtonElement>('button:not([data-archive-mode]),input:not(#archive-open-completed),select,textarea'))button.disabled=blocked;for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]'))button.disabled=blocked;find<HTMLButtonElement>('#archive-cancel').disabled=stopping;editor.setBusy(blocked);browser.setBusy(blocked);updateExtractActions();if(!value){find('#archive-loading').hidden=true;find('.archive-work-area').setAttribute('aria-busy','false');}if(!blocked)find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));};
 const addPaths=(paths:string[])=>{const existing=sourcePaths(),seen=new Set(existing.map(path=>path.toLowerCase()));for(const path of paths)if(path&&!seen.has(path.toLowerCase())){existing.push(path);seen.add(path.toLowerCase());}find<HTMLTextAreaElement>('#archive-sources').value=existing.join('\n');refreshSources();if(existing.length&&!field('#archive-target'))find<HTMLInputElement>('#archive-target').value=existing[0].replace(/[\\/][^\\/]+$/,'')+'\\'+existing[0].split(/[\\/]/).pop()+'.'+field('#archive-format');};
 const showMode=(next:'create'|'browse')=>{mode=next;for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]')){const selected=button.dataset.archiveMode===next;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));}for(const pane of root.querySelectorAll<HTMLElement>('[data-archive-pane]'))pane.hidden=pane.dataset.archivePane!==next;find(`[data-archive-pane="${next}"] .archive-rail-action`).prepend(find('#archive-status'));find('#archive-status').hidden=true;};
 for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]'))button.onclick=()=>showMode(button.dataset.archiveMode as typeof mode);
 const archiveRun=archiveRiskRunner(waiting=>{find('#archive-loading').hidden=waiting;});
 let idle=Promise.resolve(),finished=()=>{},shellQueue=Promise.resolve();
 const run=async<T>(work:(id:string)=>Promise<T>,success:(value:T)=>void,title='正在处理…')=>{if(busy)return false;taskId=crypto.randomUUID();stopping=false;idle=new Promise<void>(resolve=>finished=resolve);setBusy(true);loading(title);try{const value=await work(taskId);find('#archive-loading').hidden=true;success(value);return true;}catch(error){if(error instanceof ArchiveRiskNotice)status(error.message);else statusError(error);return false;}finally{taskId='';setBusy(false);finished();}};
 const browser=setupArchiveBrowser(root,{navigate:offset=>void load(offset,false),status,selectionChanged:count=>{selectionCount=count;updateExtractActions();editor.selectionChanged();},details:entry=>{
  if(!listing||busy||batchActive)return;
  if(entry.implicit){showArchiveDetails({entry,packedKnown:false,packedShared:false});return;}
  const source=listing;
  void run(id=>archiveRun({operation:'details',path:source.path,index:entry.index,revision:source.revision!,password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{if(!('details'in value)||!value.details)throw Error('无法读取文件信息');showArchiveDetails(value.details);status('已读取文件信息');},'正在读取文件信息…');
 }});
 let savedRecovery='';
 const savedMessage=()=>savedRecovery?'已保存压缩包修改；恢复副本待清理，请打开“恢复资料”检查。':'已保存压缩包修改';
 const editor=setupArchiveEditor(root,{listing:()=>listing,selected:()=>browser.entries(),status,externalEdit:async entry=>{
  const source=listing;if(!source?.revision)return;
  await run(id=>api.archiveEditStart({path:source.path,revision:source.revision!,index:entry.index,password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),()=>{status('编辑副本已准备，请打开副本进行编辑');showArchiveEditSessions(async archive=>{if(listing?.path===archive)await load();});},'正在准备编辑副本…');
 },save:changes=>run(id=>archiveRun({operation:'update',path:listing!.path,revision:listing!.revision!,changes,password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{savedRecovery='recovery'in value?value.recovery??'':'';status(savedMessage());}),saved:async()=>{if(await load())status(savedMessage());}});
 const invalidateListing=(message?:string)=>{listing=undefined;editor.invalidate();browser.clear(message);find('#archive-list-head').hidden=true;find('#archive-count').textContent='';find('#archive-comment').textContent='';find('#archive-comment-open').hidden=true;};
 const render=()=>{if(!listing)return;find('#archive-list-head').hidden=false;find('#archive-count').textContent=`${listing.total.toLocaleString()} 项`;
   find('#archive-comment').textContent=listing.comment;find('#archive-comment-open').hidden=!listing.comment;
   browser.loaded(listing);
   editor.loaded(listing);
 };
 const load=async(offset=0,reopen=true)=>{if(busy)return;const source=field('#archive-source');if(!source)return status('请先选择压缩包');
  syncPasswordEncoding();
  const previous=listing;
  if(reopen){if(!await editor.discardBeforeLoad())return;invalidateListing();}else if(!previous)return;
  browser.loading();
  const opened=await run(id=>archiveRun({operation:'list',path:source,offset,browse:browser.query(),password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{
   if(!('entries' in value))throw Error('无法读取压缩包');
   if(!reopen&&previous?.revision!==value.revision)throw Error('压缩包已经变化，请重新打开');
   listing=value;if(!field('#archive-parent'))find<HTMLInputElement>('#archive-parent').value=source.replace(/[\\/][^\\/]+$/,'');render();status(`已读取 ${Math.min(offset+value.entries.length,value.matched??value.total)} / ${value.matched??value.total} 项`);
  },'正在读取压缩包…');
  if(!opened)invalidateListing('读取未完成，请重新打开压缩包');
  return opened;
 };
 find<HTMLButtonElement>('#archive-add-file').onclick=async()=>{const path=await api.pickFile();if(path)addPaths([path]);};
 find<HTMLButtonElement>('#archive-add-folder').onclick=async()=>{const path=await api.pickDirectory();if(path)addPaths([path]);};
 const advancedSummary=()=>{const parts=[];if(field('#archive-create-password'))parts.push('已设置密码');if(field('#archive-volume'))parts.push(`分卷 ${field('#archive-volume')} MB`);find('#archive-advanced-summary').textContent=parts.length?parts.join(' · '):'密码、分卷、压缩等级';};
 for(const selector of ['#archive-create-password','#archive-volume'])find<HTMLInputElement>(selector).oninput=advancedSummary;
 find<HTMLSelectElement>('#archive-format').onchange=()=>{const format=field('#archive-format'),target=find<HTMLInputElement>('#archive-target');target.placeholder=`选择保存位置或输入 .${format} 路径`;if(target.value.toLowerCase().endsWith('.'+creationFormat))target.value=target.value.slice(0,-creationFormat.length)+format;creationFormat=format;find('#archive-create-password-encoding-row').hidden=format!=='zip';find('#archive-zip-compression').hidden=format!=='zip';find('#archive-zip-compatibility').hidden=format!=='zip';find('#archive-seven-compression').hidden=format!=='7z';find<HTMLSelectElement>('#archive-level').disabled=busy||batchActive||format==='tar';const encrypted=format==='zip'||format==='7z';for(const selector of ['#archive-create-password','#archive-volume']){const input=find<HTMLInputElement>(selector);input.disabled=busy||batchActive||!encrypted;if(!encrypted)input.value='';}advancedSummary();};
 find<HTMLButtonElement>('#archive-target-pick').onclick=async()=>{const folder=await api.pickDirectory();if(folder){const name=field('#archive-target').split(/[\\/]/).pop()||'archive.'+field('#archive-format');find<HTMLInputElement>('#archive-target').value=folder+'\\'+name;}};
 find<HTMLButtonElement>('#archive-create').onclick=()=>{const sources=field('#archive-sources').split(/\r?\n/).map(value=>value.trim()).filter(Boolean),target=field('#archive-target'),volume=field('#archive-volume'),format=field('#archive-format');if(!sources.length||!target)return status('请添加内容并填写压缩包位置');const aliases=format==='tar.gz'?['tar.gz','tgz']:format==='tar.xz'?['tar.xz','txz']:[format];if(!aliases.some(extension=>target.toLowerCase().endsWith('.'+extension)))return status(`压缩包位置须以 ${aliases.map(extension=>'.'+extension).join(' 或 ')} 结尾`);if(volume&&(!/^\d+$/.test(volume)||Number(volume)<1||Number(volume)>65536))return status('分卷大小须为 1–65536 MB');void run(id=>archiveRun({operation:'create',path:target,sources,level:format==='tar'?0:Number(field('#archive-level')),threads:Number(field('#archive-threads'))||undefined,autoThreads:field('#archive-threads')==='0',...(format==='zip'?{zipMethod:field('#archive-zip-method') as 'deflate'|'xz',zipEncryption:field('#archive-zip-encryption') as 'aes256'|'zipcrypto'}:{}),...(format==='7z'?{sevenMethod:field('#archive-seven-method') as 'lzma'|'lzma2',sevenSolid:(['off','solid'].includes(field('#archive-seven-solid'))?field('#archive-seven-solid'):Number(field('#archive-seven-solid'))) as import('../shared/archive-compression').ArchiveCompression['sevenSolid']}:{}),memoryMiB:Number(field('#archive-memory')),password:field('#archive-create-password'),passwordEncoding:format==='zip'?Number(field('#archive-create-password-encoding')) as ArchivePasswordEncoding:65001,volumeBytes:volume?Number(volume)*1024**2:0},id),value=>{if('count' in value){status(`已创建压缩包：${value.path}`);if(openCompleted.checked)void api.revealFile(value.path);}});};
 find<HTMLButtonElement>('#archive-open-pick').onclick=async()=>{const path=await api.pickFile();if(path){find<HTMLInputElement>('#archive-source').value=path;void load();}};
 find<HTMLButtonElement>('#archive-open').onclick=()=>void load();
 find<HTMLInputElement>('#archive-source').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void load();}};
 const applyDecode=async()=>{decodeSummary();await finishOptions('#archive-decode-dialog');if(field('#archive-source'))await load();};
 find('#archive-decode-done').onclick=()=>void applyDecode();
 find<HTMLInputElement>('#archive-password').oninput=decodeSummary;
 find<HTMLInputElement>('#archive-password').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void applyDecode();}};
 find<HTMLInputElement>('#archive-source').oninput=()=>{syncPasswordEncoding();invalidateListing('点击“打开”查看压缩包内容');find('#archive-status').hidden=true;};
 find<HTMLSelectElement>('#archive-encoding').onchange=decodeSummary;
 find<HTMLButtonElement>('#archive-parent-pick').onclick=async()=>{const folder=await api.pickDirectory();if(folder)find<HTMLInputElement>('#archive-parent').value=folder;};
 find<HTMLButtonElement>('#archive-test').onclick=async()=>{const source=listing?.path;if(!source)return;let count=0;
  const passed=await run(id=>archiveRun({operation:'test',path:source,password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{if('count' in value){count=value.count;status(`校验完成：${value.count} 项`);}},'正在校验…');
  if(stopping&&!passed)return;
  find('#archive-result-icon').innerHTML=icon(passed?'check':'info');find('#archive-result-title').textContent=passed?'校验通过':'校验未完成';find('#archive-result-file').textContent=source.split(/[\\/]/).pop()||source;
  find('#archive-result-message').textContent=passed?`已检查 ${count.toLocaleString()} 项，未发现数据损坏。`:find('#archive-status-text').textContent;
  showOptions('#archive-result-dialog');
 };
 const destinationHint=()=>{const destination=field('#archive-destination-mode'),here=destination==='here';find('#archive-conflict-row').hidden=!here;find('#archive-destination-hint').textContent=here?(field('#archive-conflict')==='replace'?'替换已有同名文件；同名文件夹合并，保留其他内容。异常时提示恢复位置。':'直接解压到目标目录；同名文件夹合并，已有文件按所选方式处理。'):destination==='smart'?'单个顶层项目直接放入目标目录；多个项目放入同名文件夹。不覆盖已有内容。':'创建同名文件夹；若已存在则使用新名称，不覆盖已有内容。';};
 find<HTMLSelectElement>('#archive-destination-mode').onchange=()=>{destinationHint();find('#archive-destination-mode').title=find('#archive-destination-hint').textContent||'';};find<HTMLSelectElement>('#archive-conflict').onchange=destinationHint;
 updateExtractActions();
 const extract=(selected:number[],selectedFolders:string[]=[])=>{lastResult=undefined;if(!listing)return;const parent=field('#archive-parent');if(!parent)return status('请选择解压目标文件夹');return run(id=>archiveRun({operation:'extract',path:listing!.path,revision:listing!.revision,parent,destination:field('#archive-destination-mode') as 'folder'|'smart'|'here',conflict:field('#archive-conflict') as ArchiveConflict,selected,selectedFolders,password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{if('count' in value){lastResult=value;if(!batchActive){const item=batchItems.find(item=>item.path.toLowerCase()===listing!.path.toLowerCase());if(item){item.state=value.cancelled?'已取消':'已完成';item.detail=`已解压 ${value.count} 项${value.skipped?`，跳过 ${value.skipped} 项`:''}到 ${value.path}`;renderBatch();}}status(value.cancelled?'已取消解压，已恢复本次改动':`已解压 ${value.count} 项${value.skipped?`，跳过 ${value.skipped} 项`:''}到 ${value.path}${value.scan?' · '+archiveScanText(value.scan):''}`);if(!value.cancelled&&openCompleted.checked)void api.revealFile(value.path);}});};
 find<HTMLButtonElement>('#archive-extract-all').onclick=()=>extract([]);
 find<HTMLButtonElement>('#archive-extract-selected').onclick=()=>{const {selected,selectedFolders}=browser.selection();if(!selected.length&&!selectedFolders.length)return status('请先选择要解压的项目');extract(selected,selectedFolders);};
 find('#archive-list').ondragstart=event=>{
   event.preventDefault();event.stopPropagation();
   const row=(event.target as Element).closest<HTMLElement>('.archive-entry'),input=row?.querySelector<HTMLInputElement>('input');
   if(busy||!input||!listing?.revision)return;
   if(editor.hasChanges())return status('请先保存或放弃待修改内容，再拖出文件');
   if(!browser.selectDrag(input))return;
   const {selected,selectedFolders}=browser.selection();
   const source=listing;
   void run(id=>archiveRun({operation:'drag',path:source.path,revision:source.revision!,selected,selectedFolders,password:field('#archive-password'),passwordEncoding:readPasswordEncoding(),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{
     if('count' in value)status(value.cancelled?'已取消拖出':`拖出操作已完成${value.scan?' · '+archiveScanText(value.scan):''}`);
   });
 };
 const stopState=()=>{stopping=true;if(batchActive)batchCancelled=true;loading('正在停止…');};
 const requestStop=async()=>{
  if(!busy||!taskId||stopping||!cancelAllowed)return;
  const id=taskId;stopState();
  try{const accepted=await api.archiveCancel(id);if(id!==taskId||!busy)return;if(!accepted){stopping=false;loading('正在完成最终保存…',false);}}
  catch{if(id===taskId&&busy&&cancelAllowed){stopping=false;find<HTMLButtonElement>('#archive-cancel').disabled=false;find<HTMLButtonElement>('#archive-cancel').innerHTML=`${icon('stop')}重试停止`;find('#archive-loading-title').textContent='任务仍在进行';find('#archive-loading-hint').textContent='停止请求未成功，可以重试';}}
 };
 find<HTMLButtonElement>('#archive-cancel').onclick=()=>void requestStop();
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&busy&&cancelAllowed&&root.getClientRects().length&&!find('#archive-loading').hidden&&!document.querySelector('dialog[open]')){event.preventDefault();event.stopPropagation();void requestStop();}});
 api.onArchiveCancelRequested(id=>{if(id===taskId)stopState();});
 api.onArchiveProgress((value:ArchiveProgress)=>{
  if(!busy||value.id!==taskId)return;
  if(value.operation==='queue'){loading(`等待可用资源${value.queuePosition?' · 队列第 '+value.queuePosition+' 位':''}`);return;}
  if(value.operation==='scan'){loading(`正在扫描恶意软件 · 已检查 ${value.done.toLocaleString()} 个文件`,true,value.done,value.total);return;}
  if(value.operation==='commit'){stopping=false;loading('正在保存结果…',false);return;}
  if(value.operation==='drag'){loading('正在传输选中内容',false,value.done,value.total);return;}
  const title=value.operation==='create'?'正在压缩':value.operation==='extract'?'正在解压':value.operation==='prepare'?'正在准备压缩包内容':value.operation==='update'?'正在校验并修改':'正在校验';
  loading(title,true,value.done,value.total);
 });
 installFileDropOverlay(root,{placement:'host',spacious:true,enabled:()=>!busy&&!batchActive,title:'压缩与解压',detail:'拖入常见压缩包浏览，或拖入文件与文件夹创建压缩包',onDrop:paths=>{if(paths.length===1&&isArchivePath(paths[0])){showMode('browse');find<HTMLInputElement>('#archive-source').value=paths[0];void load();}else{showMode('create');addPaths(paths);}}});
 const renderBatch=()=>{
  find('#archive-batch').hidden=batchItems.length<2;
  const completed=batchItems.filter(item=>item.state==='已完成').length,failed=batchItems.filter(item=>item.state==='失败').length;
  find('#archive-batch-summary').textContent=batchAction==='extract'?`${batchItems.length} 个压缩包 · 已读取 ${batchItems.filter(item=>item.state==='已读取'||item.state==='已完成').length} · 失败 ${failed}`:`${batchItems.length} 个压缩包 · 完成 ${completed} · 失败 ${failed}`;
  find('#archive-batch-list').innerHTML=batchItems.map((item,index)=>`<div class="archive-batch-item" data-batch-state="${item.state}"><div><span title="${esc(item.path)}">${esc(item.path.split(/[\\/]/).pop()||item.path)}</span><small>${esc(item.detail)}</small></div><span>${item.state}</span><button type="button" data-batch-open="${index}"${batchActive?' disabled':''}>${item.state==='失败'?'处理':'打开'}</button></div>`).join('');
 };
 const selectArchive=(path:string,action:ArchiveOpenAction)=>{
  showMode('browse');find<HTMLInputElement>('#archive-source').value=path;find<HTMLInputElement>('#archive-password').value='';find<HTMLInputElement>('#archive-parent').value='';find<HTMLSelectElement>('#archive-encoding').value='0';find<HTMLSelectElement>('#archive-password-encoding').value='65001';syncPasswordEncoding();
  find<HTMLSelectElement>('#archive-destination-mode').value=action==='extract'?'folder':action;destinationHint();decodeSummary();
 };
 find('#archive-batch-list').onclick=event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-batch-open]'),item=button&&batchItems[Number(button.dataset.batchOpen)];
  if(!item||busy||batchActive)return;
  void (async()=>{if(!await editor.discardBeforeLoad())return;selectArchive(item.path,batchAction);const opened=await load();if(batchAction==='extract'){item.state=opened?'已读取':'失败';item.detail=find('#archive-status-text').textContent||'';renderBatch();}})().catch(error=>status(error instanceof Error?error.message:String(error)));
 };
 return {activate:(_active:boolean)=>{},openShell(action:ArchiveOpenAction,paths:string[]){
   const work=async()=>{
    await preferencesReady;await idle;
    if(!paths.length||paths.length>128||paths.some(path=>typeof path!=='string'||!path)||!['create','extract','smart','here','folder'].includes(action))return status('压缩包选择无效');
    if(action!=='create'&&paths.some(path=>!isArchivePath(path)))return status('请选择支持的压缩包');
    if(!await editor.discardBeforeLoad())return;
    const preferences=await archivePreferences();openCompleted.checked=preferences.openCompleted;
    find<HTMLSelectElement>('#archive-conflict').value=preferences.conflict;
    batchItems=[];renderBatch();
    if(action==='create'){showMode('create');find<HTMLTextAreaElement>('#archive-sources').value='';find<HTMLInputElement>('#archive-target').value='';find<HTMLSelectElement>('#archive-format').value=preferences.defaultFormat;find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));addPaths(paths);return;}
    const unique=[...new Map(paths.map(path=>[path.toLowerCase(),path])).values()];batchAction=action;
    if(action==='extract'){
     batchItems=unique.map(path=>({path,state:'待打开',detail:'选择打开以浏览内容，再决定是否解压。'}));renderBatch();selectArchive(unique[0],action);const opened=await load();batchItems[0].state=opened?'已读取':'失败';batchItems[0].detail=find('#archive-status-text').textContent||'';renderBatch();return;
    }
    batchActive=true;batchCancelled=false;batchItems=unique.map(path=>({path,state:'待处理',detail:''}));renderBatch();
    try{
     for(const [index,item] of batchItems.entries()){
      if(batchCancelled){item.state='已取消';item.detail='未开始处理';continue;}
      item.state='正在处理';renderBatch();selectArchive(item.path,action);
      const opened=await load();
      if(batchCancelled){item.state='已取消';item.detail='已停止';continue;}
      if(!opened||!listing){item.state='失败';item.detail=find('#archive-status-text').textContent||'无法读取压缩包';renderBatch();continue;}
      const extracted=await extract([]);
      if(lastResult?.cancelled){batchCancelled=true;item.state='已取消';}
      else item.state=extracted?'已完成':batchCancelled?'已取消':'失败';
      item.detail=find('#archive-status-text').textContent||'';
      renderBatch();if(unique.length>1)status(`已处理 ${index+1} / ${unique.length} 个压缩包`,!batchCancelled);
     }
    }finally{batchActive=false;setBusy(false);renderBatch();}
    if(unique.length>1)status(`${batchCancelled?'已停止批量解压':'批量解压完成'} · 完成 ${batchItems.filter(item=>item.state==='已完成').length} · 失败 ${batchItems.filter(item=>item.state==='失败').length} · 已取消 ${batchItems.filter(item=>item.state==='已取消').length}`);
   };
   const next=shellQueue.then(work,work);shellQueue=next.catch(()=>{});return next;
 }};
}
