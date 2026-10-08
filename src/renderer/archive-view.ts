import {api,esc,icon} from './ui';
import {installFileDropOverlay} from './file-drop-overlay';
import {archivePreferences} from './archive-settings';
import {archiveEditorMarkup,setupArchiveEditor} from './archive-editor';
import type {ArchiveListing,ArchiveEncoding,ArchiveProgress,ArchiveConflict,ArchiveResult} from '../shared/archive';
import {isArchivePath,type ArchiveOpenAction} from '../shared/archive-actions';
import './archive-view.css';

export function archivePage(){return `<div class="archive-workspace">
 <div class="archive-toolbar"><div class="archive-mode tabs" role="tablist" aria-label="压缩与解压"><button type="button" data-archive-mode="create" class="selected" aria-selected="true">创建压缩包</button><button type="button" data-archive-mode="browse" aria-selected="false">浏览与解压</button></div><label class="archive-open-completed"><input id="archive-open-completed" type="checkbox">完成后打开文件夹</label></div>
 <section class="archive-panel" data-archive-pane="create"><div class="archive-panel-title"><h2>创建压缩包</h2><span>可添加多个文件或文件夹</span></div>
  <div class="archive-input-group"><div class="archive-label-row"><label for="archive-sources">压缩内容</label><div><button id="archive-add-file" type="button">添加文件</button><button id="archive-add-folder" type="button">添加文件夹</button></div></div><textarea id="archive-sources" rows="4" placeholder="拖入文件或文件夹，也可以每行粘贴一个完整路径"></textarea></div>
  <div class="archive-fields archive-options"><label>压缩格式<select id="archive-format"><option value="zip">ZIP</option><option value="7z">7Z</option><option value="tar">TAR</option><option value="tar.gz">TAR.GZ</option><option value="tar.xz">TAR.XZ</option><option value="gz">GZ（单文件）</option><option value="xz">XZ（单文件）</option></select></label><label>压缩包位置<input id="archive-target" placeholder="选择保存位置或输入 .zip 路径"></label><button id="archive-target-pick" type="button">选择文件夹</button></div>
  <div class="archive-fields"><label>加密密码 <span>留空则不加密</span><input id="archive-create-password" type="password" autocomplete="new-password" placeholder="可选，使用 AES 加密"></label></div>
  <div class="archive-fields"><label>分卷大小（MB） <span>留空则创建单个压缩包</span><input id="archive-volume" type="number" min="1" max="65536" step="1" placeholder="例如 1024"></label></div>
  <div class="archive-actions"><p>创建后自动校验。已有文件不会被覆盖。</p><button id="archive-create" class="primary" type="button">创建压缩包</button></div>
 </section>
 <section class="archive-panel" data-archive-pane="browse" hidden><div class="archive-panel-title"><h2>浏览压缩包</h2><span>勾选多项后，可拖到资源管理器中解压</span></div>
  <div class="archive-fields"><label>压缩包<input id="archive-source" placeholder="选择 ZIP、7Z、RAR、TAR、GZ 或 XZ 文件，也可拖入压缩包"></label><button id="archive-open-pick" type="button">选择文件</button><button id="archive-open" type="button">打开</button></div>
  <div class="archive-fields archive-options"><label>旧文件名编码<select id="archive-encoding"><option value="0">自动</option><option value="437">CP437</option><option value="936">GBK / CP936</option><option value="932">Shift JIS / CP932</option><option value="950">Big5 / CP950</option><option value="65001">UTF-8</option></select></label><label>解压密码<input id="archive-password" type="password" autocomplete="off" placeholder="加密压缩包需要密码"></label></div>
  <div id="archive-list-head" class="archive-list-head" hidden><div><strong id="archive-count"></strong><span id="archive-comment"></span></div><button id="archive-test" type="button">测试完整性</button></div>
  ${archiveEditorMarkup()}
  <div id="archive-list" class="archive-list"><div class="archive-empty">选择压缩包后查看其中的内容</div></div><button id="archive-more" type="button" hidden>加载更多</button>
  <div class="archive-fields archive-destination"><label>解压到<input id="archive-parent" placeholder="选择目标文件夹"></label><button id="archive-parent-pick" type="button">选择文件夹</button></div>
  <div class="archive-fields"><label>解压方式<select id="archive-destination-mode"><option value="folder">解压到同名文件夹</option><option value="smart">智能解压</option><option value="here">解压至此</option></select></label><label id="archive-conflict-row" hidden>同名文件<select id="archive-conflict"><option value="rename">自动重命名 · 保留原文件</option><option value="skip">跳过</option><option value="replace">替换文件</option></select></label></div>
  <div class="archive-actions"><p id="archive-destination-hint">智能解压时，单个顶层项目直接放入目标目录；多个项目放入同名文件夹。已有内容不会被覆盖。</p><button id="archive-extract-selected" type="button">解压选中项</button><button id="archive-extract-all" class="primary" type="button">全部解压</button></div>
 </section>
 <section id="archive-batch" class="archive-panel archive-batch" hidden aria-label="批量处理结果"><div class="archive-panel-title"><h2>批量处理结果</h2><span id="archive-batch-summary" aria-live="polite"></span></div><div id="archive-batch-list"></div></section>
 <div id="archive-status" class="archive-status" role="status" hidden><span id="archive-status-text"></span><button id="archive-cancel" type="button" hidden>取消</button></div>
 </div>`;}

export function setupArchiveView(){
 const root=document.querySelector<HTMLElement>('#page-archive')!;
 const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 const field=(selector:string)=>{const input=find<HTMLInputElement>(selector);return input.type==='password'?input.value:input.value.trim();};
 let mode:'create'|'browse'='create',listing:ArchiveListing|undefined,busy=false,taskId='',creationFormat='zip';
 type BatchItem={path:string;state:'待处理'|'正在处理'|'已完成'|'失败'|'已取消'|'待打开'|'已读取';detail:string};
 let batchActive=false,batchCancelled=false,batchItems:BatchItem[]=[],batchAction:ArchiveOpenAction='extract',lastResult:ArchiveResult|undefined;
 const openCompleted=find<HTMLInputElement>('#archive-open-completed');
 const preferencesReady=archivePreferences().then(value=>{openCompleted.checked=value.openCompleted;find<HTMLSelectElement>('#archive-conflict').value=value.conflict;find<HTMLSelectElement>('#archive-format').value=value.defaultFormat;find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));});
 void preferencesReady.catch(error=>status(error instanceof Error?error.message:String(error)));
 api.onArchivePreferences(value=>{openCompleted.checked=value.openCompleted;if(!busy&&!field('#archive-target')&&!field('#archive-sources')){find<HTMLSelectElement>('#archive-format').value=value.defaultFormat;find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));}});
 openCompleted.onchange=()=>{void api.patchSettings({archive:{openCompleted:openCompleted.checked}}).catch(error=>{status(error instanceof Error?error.message:String(error));void archivePreferences().then(value=>openCompleted.checked=value.openCompleted).catch(()=>{});});};
 const status=(message:string,running=false)=>{find('#archive-status').hidden=false;find('#archive-status-text').textContent=message;find('#archive-cancel').hidden=!running;};
 const setBusy=(value:boolean)=>{busy=value;const blocked=value||batchActive;for(const button of root.querySelectorAll<HTMLButtonElement>('button:not([data-archive-mode]),input:not(#archive-open-completed),select,textarea'))button.disabled=blocked;for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]'))button.disabled=batchActive;find<HTMLButtonElement>('#archive-cancel').disabled=false;editor.setBusy(blocked);if(!blocked)find<HTMLSelectElement>('#archive-format').dispatchEvent(new Event('change'));};
 const addPaths=(paths:string[])=>{const existing=field('#archive-sources').split(/\r?\n/).filter(Boolean),seen=new Set(existing.map(path=>path.toLowerCase()));for(const path of paths)if(path&&!seen.has(path.toLowerCase())){existing.push(path);seen.add(path.toLowerCase());}find<HTMLTextAreaElement>('#archive-sources').value=existing.join('\n');if(existing.length&&!field('#archive-target'))find<HTMLInputElement>('#archive-target').value=existing[0].replace(/[\\/][^\\/]+$/,'')+'\\'+existing[0].split(/[\\/]/).pop()+'.'+field('#archive-format');};
 const showMode=(next:'create'|'browse')=>{mode=next;for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]')){const selected=button.dataset.archiveMode===next;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));}for(const pane of root.querySelectorAll<HTMLElement>('[data-archive-pane]'))pane.hidden=pane.dataset.archivePane!==next;};
 for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]'))button.onclick=()=>showMode(button.dataset.archiveMode as typeof mode);
 let idle=Promise.resolve(),finished=()=>{},shellQueue=Promise.resolve();
 const run=async<T>(work:(id:string)=>Promise<T>,success:(value:T)=>void)=>{if(busy)return false;taskId=crypto.randomUUID();idle=new Promise<void>(resolve=>finished=resolve);setBusy(true);status('正在处理…',true);try{const value=await work(taskId);success(value);return true;}catch(error){status(error instanceof Error?error.message:String(error));return false;}finally{taskId='';setBusy(false);finished();}};
 const editor=setupArchiveEditor(root,{listing:()=>listing,status,save:changes=>run(id=>api.archiveRun({operation:'update',path:listing!.path,revision:listing!.revision!,changes,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),()=>status('已保存压缩包修改')),saved:async()=>{if(await load())status('已保存压缩包修改');}});
 const render=()=>{if(!listing)return;find('#archive-list-head').hidden=false;find('#archive-count').textContent=`${listing.total.toLocaleString()} 项`;
   find('#archive-comment').textContent=listing.comment?`备注：${listing.comment}`:'';
   const host=find('#archive-list');if(listing.offset===0)host.innerHTML='';
   host.insertAdjacentHTML('beforeend',listing.entries.map(entry=>`<label class="archive-entry" draggable="true"><input type="checkbox" value="${entry.index}"><span class="archive-entry-icon">${icon(entry.directory?'folder':'file')}</span><span class="archive-entry-name" title="${esc(entry.name)}">${esc(entry.name)}</span><span>${entry.encrypted?'已加密':''}</span><span>${entry.directory?'文件夹':(entry.size/1024).toLocaleString(undefined,{maximumFractionDigits:1})+' KB'}</span></label>`).join(''));
   find('#archive-more').hidden=listing.offset+listing.entries.length>=listing.total;
   editor.loaded(listing);
 };
 const load=async(offset=0)=>{if(busy)return;const source=field('#archive-source');if(!source)return status('请先选择压缩包');if(offset===0){if(!await editor.discardBeforeLoad())return;listing=undefined;editor.invalidate();find('#archive-list-head').hidden=true;find('#archive-more').hidden=true;find('#archive-list').innerHTML='<div class="archive-empty">正在读取压缩包…</div>';}return run(id=>api.archiveRun({operation:'list',path:source,offset,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{if(!('entries' in value))return;if(offset>0&&listing?.revision!==value.revision)throw Error('压缩包已经变化，请重新打开');listing=value;if(offset===0&&!field('#archive-parent'))find<HTMLInputElement>('#archive-parent').value=source.replace(/[\\/][^\\/]+$/,'');render();status(`已读取 ${Math.min(offset+value.entries.length,value.total)} / ${value.total} 项`);});};
 find<HTMLButtonElement>('#archive-add-file').onclick=async()=>{const path=await api.pickFile();if(path)addPaths([path]);};
 find<HTMLButtonElement>('#archive-add-folder').onclick=async()=>{const path=await api.pickDirectory();if(path)addPaths([path]);};
 find<HTMLSelectElement>('#archive-format').onchange=()=>{const format=field('#archive-format'),target=find<HTMLInputElement>('#archive-target');target.placeholder=`选择保存位置或输入 .${format} 路径`;if(target.value.toLowerCase().endsWith('.'+creationFormat))target.value=target.value.slice(0,-creationFormat.length)+format;creationFormat=format;const encrypted=format==='zip'||format==='7z';for(const selector of ['#archive-create-password','#archive-volume']){const input=find<HTMLInputElement>(selector);input.disabled=!encrypted;if(!encrypted)input.value='';}};
 find<HTMLButtonElement>('#archive-target-pick').onclick=async()=>{const folder=await api.pickDirectory();if(folder)find<HTMLInputElement>('#archive-target').value=folder+'\\archive.'+field('#archive-format');};
 find<HTMLButtonElement>('#archive-create').onclick=()=>{const sources=field('#archive-sources').split(/\r?\n/).map(value=>value.trim()).filter(Boolean),target=field('#archive-target'),volume=field('#archive-volume'),format=field('#archive-format');if(!sources.length||!target)return status('请添加内容并填写压缩包位置');const aliases=format==='tar.gz'?['tar.gz','tgz']:format==='tar.xz'?['tar.xz','txz']:[format];if(!aliases.some(extension=>target.toLowerCase().endsWith('.'+extension)))return status(`压缩包位置须以 ${aliases.map(extension=>'.'+extension).join(' 或 ')} 结尾`);if(volume&&(!/^\d+$/.test(volume)||Number(volume)<1||Number(volume)>65536))return status('分卷大小须为 1–65536 MB');void run(id=>api.archiveRun({operation:'create',path:target,sources,password:field('#archive-create-password'),volumeBytes:volume?Number(volume)*1024**2:0},id),value=>{if('count' in value){status(`已创建压缩包：${value.path}`);if(openCompleted.checked)void api.revealFile(value.path);}});};
 find<HTMLButtonElement>('#archive-open-pick').onclick=async()=>{const path=await api.pickFile();if(path){find<HTMLInputElement>('#archive-source').value=path;void load();}};
 find<HTMLButtonElement>('#archive-open').onclick=()=>void load();
 find<HTMLInputElement>('#archive-source').oninput=()=>{listing=undefined;editor.invalidate();find('#archive-list-head').hidden=true;find('#archive-more').hidden=true;find('#archive-list').innerHTML='<div class="archive-empty">点击“打开”查看压缩包内容</div>';};
 find<HTMLButtonElement>('#archive-more').onclick=()=>{if(listing)void load(listing.offset+listing.entries.length);};
 find<HTMLSelectElement>('#archive-encoding').onchange=()=>{if(field('#archive-source'))void load();};
 find<HTMLButtonElement>('#archive-parent-pick').onclick=async()=>{const folder=await api.pickDirectory();if(folder)find<HTMLInputElement>('#archive-parent').value=folder;};
 find<HTMLButtonElement>('#archive-test').onclick=()=>{const source=listing?.path;if(!source)return;void run(id=>api.archiveRun({operation:'test',path:source,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{if('count' in value)status(`校验完成：${value.count} 项`);});};
 const destinationHint=()=>{const here=field('#archive-destination-mode')==='here';find('#archive-conflict-row').hidden=!here;find('#archive-destination-hint').textContent=here?(field('#archive-conflict')==='replace'?'替换已有同名文件；同名文件夹合并，保留其他内容。替换前保留恢复副本，异常时提示恢复位置。':'直接解压到上方目标目录；同名文件夹合并，已有文件按所选方式处理。'):'智能解压时，单个顶层项目直接放入目标目录；多个项目放入同名文件夹。已有内容不会被覆盖。';};
 find<HTMLSelectElement>('#archive-destination-mode').onchange=destinationHint;find<HTMLSelectElement>('#archive-conflict').onchange=destinationHint;
 const extract=(selected:number[])=>{lastResult=undefined;if(!listing)return;const parent=field('#archive-parent');if(!parent)return status('请选择解压目标文件夹');return run(id=>api.archiveRun({operation:'extract',path:listing!.path,parent,destination:field('#archive-destination-mode') as 'folder'|'smart'|'here',conflict:field('#archive-conflict') as ArchiveConflict,selected,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{if('count' in value){lastResult=value;if(!batchActive){const item=batchItems.find(item=>item.path.toLowerCase()===listing!.path.toLowerCase());if(item){item.state=value.cancelled?'已取消':'已完成';item.detail=`已解压 ${value.count} 项${value.skipped?`，跳过 ${value.skipped} 项`:''}到 ${value.path}`;renderBatch();}}status(value.cancelled?'已取消解压，已恢复本次改动':`已解压 ${value.count} 项${value.skipped?`，跳过 ${value.skipped} 项`:''}到 ${value.path}`);if(!value.cancelled&&openCompleted.checked)void api.revealFile(value.path);}});};
 find<HTMLButtonElement>('#archive-extract-all').onclick=()=>extract([]);
 find<HTMLButtonElement>('#archive-extract-selected').onclick=()=>{const selected=[...root.querySelectorAll<HTMLInputElement>('.archive-entry input:checked')].map(input=>Number(input.value));if(!selected.length)return status('请先选择要解压的项目');extract(selected);};
 find('#archive-list').ondragstart=event=>{
   event.preventDefault();event.stopPropagation();
   const row=(event.target as Element).closest<HTMLElement>('.archive-entry'),input=row?.querySelector<HTMLInputElement>('input');
   if(busy||!input||!listing?.revision)return;
   if(editor.hasChanges())return status('请先保存或放弃待修改内容，再拖出文件');
   if(!input.checked){for(const other of root.querySelectorAll<HTMLInputElement>('.archive-entry input'))other.checked=false;input.checked=true;}
   const selected=[...root.querySelectorAll<HTMLInputElement>('.archive-entry input:checked')].map(item=>Number(item.value));
   const source=listing;
   void run(id=>api.archiveRun({operation:'drag',path:source.path,revision:source.revision!,selected,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding},id),value=>{
     if('count' in value)status(value.cancelled?'已取消拖出':'拖出操作已完成');
   });
 };
 find<HTMLButtonElement>('#archive-cancel').onclick=()=>{if(batchActive)batchCancelled=true;if(taskId)void api.archiveCancel(taskId);};
 api.onArchiveProgress((value:ArchiveProgress)=>{if(!busy||value.id!==taskId)return;if(value.operation==='commit'){status('正在保存压缩包…');return;}if(value.operation==='drag'){status(value.total?`正在传输选中内容 · ${value.done} / ${value.total}`:'拖到目标文件夹后松开鼠标；按 Esc 取消');return;}status(`${value.operation==='create'?'正在压缩':value.operation==='extract'?'正在解压':value.operation==='prepare'?'正在准备压缩包内容':value.operation==='update'?'正在校验并修改':'正在校验'} · ${value.done} / ${value.total||'…'}`,true);});
 installFileDropOverlay(root,{placement:'host',spacious:true,enabled:()=>!busy&&!batchActive,title:'压缩与解压',detail:'拖入常见压缩包浏览，或拖入文件与文件夹创建压缩包',onDrop:paths=>{if(paths.length===1&&isArchivePath(paths[0])){showMode('browse');find<HTMLInputElement>('#archive-source').value=paths[0];void load();}else{showMode('create');addPaths(paths);}}});
 const renderBatch=()=>{
  find('#archive-batch').hidden=batchItems.length<2;
  const completed=batchItems.filter(item=>item.state==='已完成').length,failed=batchItems.filter(item=>item.state==='失败').length;
  find('#archive-batch-summary').textContent=batchAction==='extract'?`${batchItems.length} 个压缩包 · 已读取 ${batchItems.filter(item=>item.state==='已读取'||item.state==='已完成').length} · 失败 ${failed}`:`${batchItems.length} 个压缩包 · 完成 ${completed} · 失败 ${failed}`;
  find('#archive-batch-list').innerHTML=batchItems.map((item,index)=>`<div class="archive-batch-item" data-batch-state="${item.state}"><div><span title="${esc(item.path)}">${esc(item.path.split(/[\\/]/).pop()||item.path)}</span><small>${esc(item.detail)}</small></div><span>${item.state}</span><button type="button" data-batch-open="${index}"${batchActive?' disabled':''}>${item.state==='失败'?'处理':'打开'}</button></div>`).join('');
 };
 const selectArchive=(path:string,action:ArchiveOpenAction)=>{
  showMode('browse');find<HTMLInputElement>('#archive-source').value=path;find<HTMLInputElement>('#archive-password').value='';find<HTMLInputElement>('#archive-parent').value='';find<HTMLSelectElement>('#archive-encoding').value='0';
  find<HTMLSelectElement>('#archive-destination-mode').value=action==='extract'?'folder':action;destinationHint();
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
