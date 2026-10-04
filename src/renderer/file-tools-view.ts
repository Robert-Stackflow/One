import {api,q,esc,icon,iconButton,button,size,toast,action} from './ui';
import {customControls} from './controls';
import {confirmDialog} from './dialog';
import {hydrateFileIcons} from './shell-icons';
import {setupViewportPanel} from './viewport-panel';
import {PagedResultList,type ResultLocation} from './paged-result-list';
import {DeferredWork} from './deferred-work';
import {pathField,initialPickerPath} from './path-field';
import {isWindowVisible,onWindowVisibility} from './window-visibility';
import {defaultRename,type RenameOptions,type FileToolTask,type FileToolReport,type FileToolKind,type FileToolRow,type FileToolProgress} from '../shared/file-tools';
import './file-tools.css';
const tabs=[['duplicates','重复文件'],['diff','文件比较'],['rename','批量重命名'],['documents','全文搜索']] as const;
type ToolTab=typeof tabs[number][0];
const folderField=(id:string,label:string)=>`<div class="tool-field"><label for="${id}">${label}</label>${pathField(id,label,{attributes:`data-tool-folder="${id}"`,label:'选择'+label})}</div>`;
const comparisonField=(side:string,label:string)=>`<div class="tool-field"><label for="diff-${side}">${label}</label>${pathField('diff-'+side,label+'路径',{id:'diff-'+side+'-pick',label:'选择'+label},'选择文件或粘贴路径')}</div>`;
export function fileToolsPage(){return `<div class="module-toolbar file-tools-toolbar"><div class="tabs" role="tablist" aria-label="文件工具">${tabs.map(([id,label],index)=>`<button id="tool-tab-${id}" role="tab" aria-selected="${index===0}" class="${index===0?'selected':''}" data-tool-tab="${id}">${label}</button>`).join('')}</div><div class="toolbar">${iconButton('rename-open-window','独立窗口','open')}${button('tool-stop','停止','stop')}${button('tool-run','查找重复','search',true)}</div></div>
 <section id="tool-pane-duplicates" class="file-tool-pane"><div class="tool-config">${folderField('duplicates-root','扫描范围')}<div class="tool-options"><label><input id="duplicates-recursive" type="checkbox" checked>包含子文件夹</label><label>最小大小 <input id="duplicates-min" type="number" min="0" value="0" step="1"> MB</label><label class="tool-inline-field">文件类型<input id="duplicates-types" placeholder="全部类型，如 jpg png pdf"></label></div></div></section>
 <section id="tool-pane-diff" class="file-tool-pane" hidden><div class="tool-config"><div class="tabs" role="group" aria-label="比较对象"><button type="button" data-diff-mode="file" class="selected" aria-pressed="true">文件内容</button><button type="button" data-diff-mode="folder" aria-pressed="false">文件夹</button></div><div class="tool-field-pair">${comparisonField('left','左侧 / 原始')}${comparisonField('right','右侧 / 对照')}</div><div class="tool-options"><label><input id="file-diff-ignore-space" type="checkbox">忽略行首尾空白</label><label class="tool-inline-field">文本编码<select id="diff-encoding"><option>自动</option><option>UTF-8</option><option>UTF-16</option><option>GBK</option><option>Big5</option></select></label><span class="tool-hint">文本按行对比；其他文件校验完整内容</span></div></div></section>
 <section id="tool-pane-rename" class="file-tool-pane" hidden>
  <div class="tool-config rename-config">
   <section class="rename-scope" aria-labelledby="rename-scope-title">
    <h2 id="rename-scope-title" class="rename-section-title"><span aria-hidden="true">1</span>处理范围</h2>
    <div class="rename-add-actions">${button('rename-add-file','添加文件','file')}${button('rename-add-folder','添加文件夹','folder')}</div>
    <textarea id="rename-paths" rows="3" aria-label="重命名项目" aria-describedby="rename-scope-hint" placeholder="拖入文件或文件夹\n也可以每行粘贴一个路径"></textarea>
    <div class="tool-options rename-scope-options"><label><input id="rename-files" type="checkbox" checked>文件</label><label><input id="rename-folders" type="checkbox">文件夹</label><label><input id="rename-recursive" type="checkbox">包含子文件夹</label><label><input id="rename-selected" type="checkbox">仅处理所选项目</label></div>
    <p id="rename-scope-hint" class="tool-hint">添加文件夹时默认处理其中的项目。启用“仅处理所选项目”可重命名文件夹自身。</p>
   </section>
   <section class="rename-rules" aria-labelledby="rename-rules-title">
    <h2 id="rename-rules-title" class="rename-section-title"><span aria-hidden="true">2</span>替换规则</h2>
    <div class="tool-field-pair"><label class="tool-field">查找<input id="rename-search" aria-label="查找文件名" placeholder="原名称或正则表达式"></label><label class="tool-field">替换为<input id="rename-replace" aria-label="替换为" placeholder="新的名称，可留空"></label></div>
    <div class="tool-options rename-match-options"><label><input id="rename-regex" type="checkbox">正则表达式</label><label><input id="rename-case" type="checkbox">区分大小写</label><label><input id="rename-all" type="checkbox" checked>替换所有匹配</label></div>
    <label class="tool-field rename-target-field">应用于<select id="rename-target" aria-label="应用于"><option value="stem">文件名，保留扩展名</option><option value="name">完整名称</option><option value="extension">扩展名</option></select></label>
   </section>
   <details id="rename-format-options" class="rename-format">
    <summary><span class="rename-section-title"><span aria-hidden="true">3</span>编号与格式</span><span class="rename-format-caption">文字格式、序号、日期变量</span>${icon('chevron-down')}</summary>
    <div class="rename-format-body">
     <label class="tool-field">文字格式<select id="rename-case-mode" aria-label="文字格式"><option value="keep">保持原样</option><option value="lower">全部小写</option><option value="upper">全部大写</option><option value="title">单词首字母大写</option></select></label>
     <div class="rename-number-fields"><label class="tool-field">起始序号<input id="rename-start" aria-label="起始序号" type="number" value="1" step="1"></label><label class="tool-field">每次递增<input id="rename-increment" aria-label="每次递增" type="number" value="1" step="1"></label><label class="tool-field">序号位数<input id="rename-padding" aria-label="序号位数" type="number" value="3" min="0" max="12"></label></div>
     <label class="rename-enumerate-option"><input id="rename-enumerate" type="checkbox">在名称末尾追加序号</label>
     <p class="tool-hint rename-variable-hint">替换文本可使用：序号 <code>\${n}</code> · 指定位数 <code>\${padding=3}</code> · 创建日期 <code>$YYYY-$MM-$DD</code> · 正则分组 <code>$1</code></p>
    </div>
   </details>
  </div>
  <div class="rename-actions"><label><input id="rename-select-all" type="checkbox" checked>选择全部可用项目</label><span id="rename-selection"></span><div class="spacer"></div>${button('rename-undo','撤销上次','rewind')}${button('rename-apply','执行重命名','rename',true)}</div>
 </section>
 <section id="tool-pane-documents" class="file-tool-pane" hidden><div class="tool-config">${folderField('documents-root','文档范围')}<div class="tool-document-search">${icon('search')}<input id="documents-query" aria-label="搜索文档正文" placeholder="搜索文档正文，支持中文与短语" maxlength="256">${button('documents-search','搜索')}</div><div class="tool-options"><label><input id="documents-recursive" type="checkbox" checked>包含子文件夹</label><span id="documents-index-state" class="tool-hint">选择范围后首次搜索会建立本地正文索引</span><button id="documents-issues" class="quiet" hidden>查看未完成项</button></div></div></section>
 <div id="tool-progress" class="tool-progress" role="status" hidden><span class="tool-progress-dot"></span><strong id="tool-phase"></strong><span id="tool-count"></span><span id="tool-current-path"></span></div><div class="tool-result-heading"><div><h2 id="tool-result-title">查找内容相同的文件</h2><span id="tool-result-detail"></span></div><button id="tool-issues" class="quiet" hidden></button></div><div id="tool-results" class="tool-results"><div class="tool-empty">${icon('copy')}<h3>先选择扫描范围</h3><p>按大小筛选，再校验完整文件内容。</p></div></div>`;}
export function setupFileTools(){
 let tab:ToolTab='duplicates',diffMode:'file'|'folder'='file',report:FileToolReport|undefined,active=new Map<string,FileToolKind>(),reports=new Map<ToolTab,FileToolReport>(),lastReceipt='',documentIndexed=false,autoPreview=false,planFresh=false,renameRevision=0,queryRevision=0,indexedScope='',indexReport:FileToolReport|undefined,only:Set<number>|null=null,excluded=new Set<number>(),moduleActive=false;
 let visible=false,viewDirty=true;
 let resultList:PagedResultList<FileToolRow>|undefined,groupList:PagedResultList<FileToolRow>|undefined,selectedGroup:number|undefined,openOnGroup=false,renderedReportId='';
 const locations=new Map<string,{main:ResultLocation;group?:number;detail?:ResultLocation;detailOpen:boolean}>();
 const progress=new Map<ToolTab,FileToolProgress>();
 const showing=()=>moduleActive&&isWindowVisible();
 const panel=q('tool-results'),viewport=panel.closest<HTMLElement>('.file-action-results')||q('page-tools').closest<HTMLElement>('.content,.file-action-content')!;
 const docking=setupViewportPanel(viewport,panel);
 const narrow=matchMedia('(max-width:1060px)');
 const input=(id:string)=>q<HTMLInputElement>(id),value=(id:string)=>input(id).value.trim(),checked=(id:string)=>input(id).checked,key=(kind:FileToolKind):ToolTab=>kind.startsWith('rename-')?'rename':kind.startsWith('document-')?'documents':kind as ToolTab;
 const root=(id:string)=>{const path=value(id);if(!path)throw Error('请先选择文件夹');return[path];};
 for(const name of ['duplicates-root','documents-root','rename-paths'])input(name).value=localStorage.getItem('tool-'+name)||'';
 const updateButtons=()=>{if(!showing())return;q('rename-open-window').hidden=tab!=='rename'||document.body.classList.contains('file-action-window');q<HTMLButtonElement>('tool-run').disabled=active.has(tab);q<HTMLButtonElement>('tool-stop').disabled=!active.has(tab)||['rename-apply','rename-undo'].includes(active.get(tab)||'');q('tool-run').innerHTML=icon(tab==='rename'?'rename':tab==='diff'?'braces':'search')+({duplicates:'查找重复',diff:'开始比较',rename:document.body.classList.contains('file-action-rename')?'刷新预览':'预览重命名',documents:'更新索引'}[tab]);q<HTMLButtonElement>('rename-apply').disabled=!planFresh||!reports.get('rename')||!(only?only.size:(reports.get('rename')!.stats.changes||0)-excluded.size)||active.has('rename');q<HTMLButtonElement>('rename-undo').disabled=!lastReceipt||active.has('rename');q<HTMLButtonElement>('documents-search').disabled=active.has('documents');q('tool-progress').hidden=!active.has(tab);if(document.body.classList.contains('file-action-rename'))q('tool-stop').hidden=!active.has(tab);};
 const progressTitle=()=>{if(!showing())return;q('tool-result-title').textContent=report?.summary||({duplicates:'查找内容相同的文件',diff:'比较文件与文件夹',rename:'名称预览',documents:'搜索文档正文'}[tab]);q('tool-result-detail').textContent=report?report.kind==='duplicates'?`扫描 ${report.stats.scanned.toLocaleString()} 个文件 · 重复占用 ${size(report.stats.wasted)}`:report.kind==='document-search'?`${report.stats.files.toLocaleString()} 份文档 · 正文片段`:report.kind==='rename-preview'?'先预览，再执行；同名目标会明确标出':report.kind==='diff'&&report.stats.grouped?'差异密集，按连续文本块展示；行数包含块内内容':new Date(report.created).toLocaleString():'';q('tool-issues').hidden=!report?.issueCount;q('tool-issues').textContent=report?.issueCount?`${report.issueCount} 项未完成`:'';};
 const pathActions=(path:string)=>`<span class="tool-row-actions"><button class="icon-button quiet" data-tool-preview="${esc(path)}" aria-label="快速预览" title="快速预览">${icon('preview')}</button><button class="icon-button quiet" data-tool-reveal="${esc(path)}" aria-label="在资源管理器中显示" title="在资源管理器中显示">${icon('folder')}</button><button class="icon-button quiet" data-tool-copy="${esc(path)}" aria-label="复制路径" title="复制路径">${icon('copy')}</button></span>`;
 const selected=(id:number)=>only?only.has(id):!excluded.has(id);
 const selection=()=>{if(!showing())return;const total=reports.get('rename')?.stats.changes||0;const count=only?only.size:Math.max(0,total-excluded.size);q('rename-selection').textContent=`${count} 项已选`;input('rename-select-all').checked=total>0&&count===total;input('rename-select-all').indeterminate=count>0&&count<total;updateButtons();};
 const rowHTML=(r:FileToolRow)=>{if(report?.kind==='duplicates'){const samples=r.samples as string[];return `<button class="duplicate-group" data-group="${r.id}" tabindex="-1" aria-pressed="false"><span class="tool-file-icon">${icon('copy')}</span><span><strong>${esc(samples[0].split(/[\\/]/).pop())}</strong><small>${esc(samples[0])}</small></span><span class="duplicate-group-count">${r.files} 份<small>${size(Number(r.size))} / 文件</small></span>${icon('chevron')}</button>`;}
  if(report?.kind==='rename-preview'||report?.kind==='rename-apply'){const valid=r.status==='可重命名';return `<div class="rename-result-row ${valid?'rename-valid':r.status==='无变化'||r.status==='已重命名'?'':'rename-conflict'}"><input type="checkbox" data-rename-id="${r.id}" aria-label="选择 ${esc(r.name)}" ${valid&&selected(r.id)?'checked':''} ${valid?'':'disabled'}><span><strong>${esc(r.name)}</strong><small>${esc(r.path)}</small></span>${icon('arrow')}<span><strong>${esc(r.newName)}</strong><small>${esc(r.status)}</small></span></div>`;}
  if(report?.kind==='document-search'){const ext=String(r.path).split('.').at(-1)?.toLowerCase(),location=ext==='pdf'?'第 '+Number(r.page)+' 页':ext==='pptx'?'第 '+Number(r.page)+' 张幻灯片':(ext==='xlsx'||ext==='xlsm'?'工作表 '+Number(r.page)+' · ':'')+'第 '+Number(r.line)+' 行附近';let snippet=esc(r.snippet);const terms=String(r.query).split(/\s+/).filter(Boolean).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));if(terms.length)snippet=snippet.replace(new RegExp(terms.map(esc).join('|'),'gi'),s=>'<mark>'+s+'</mark>');return `<div class="document-match tool-file-row"><span class="tool-file-icon" data-file-icon="${esc(r.path)}">${icon('file')}</span><div><strong>${esc(String(r.path).split(/[\\/]/).pop())}<small>${location}</small></strong><p data-selectable>${snippet}</p><small>${esc(r.path)}</small></div>${pathActions(String(r.path))}</div>`;}
  if(r.leftText!==undefined)return `<article class="file-diff-hunk diff-change"><header><strong>${esc(r.status)}</strong><span>原始 ${r.oldLine} 行 · 对照 ${r.newLine} 行</span></header><div class="diff-column-headings"><span>原始</span><span>对照</span></div><div class="diff-columns"><pre>${esc(r.leftText)}</pre><pre>${esc(r.rightText)}</pre></div></article>`;
  const path=String(r.right||r.left||r.path||'');return `<div class="tool-file-row"><span class="tool-file-icon" data-file-icon="${esc(path)}">${icon(r.directory?'folder':'file')}</span><div><strong>${esc(r.name||path.split(/[\\/]/).pop())}<small>${esc(r.status)}</small></strong><small>${esc(r.left||'—')} → ${esc(r.right||'—')}</small>${r.leftHash?`<code>SHA-256<br>${esc(r.leftHash)}<br>${esc(r.rightHash)}</code>`:''}</div>${pathActions(path)}</div>`;
 };
 const remember=()=>{
  if(!renderedReportId||!resultList)return;
  locations.set(renderedReportId,{main:resultList.location(),group:selectedGroup,detail:groupList?.location(),detailOpen:panel.classList.contains('detail-open')});
  while(locations.size>8)locations.delete(locations.keys().next().value!);
 };
 const syncLists=()=>{
  const docked=panel.classList.contains('viewport-docked'),detailOpen=narrow.matches&&panel.classList.contains('detail-open');
  if(!docked&&groupList){const top=-parseFloat(getComputedStyle(viewport).paddingTop)+'px';if(panel.style.getPropertyValue('--tool-heading-top')!==top)panel.style.setProperty('--tool-heading-top',top);}
  if(resultList){resultList.setViewport(docked?panel.querySelector<HTMLElement>('.tool-result-scroll')!:viewport);resultList.setActive(showing()&&!detailOpen);}
  if(groupList){groupList.setViewport(docked?panel.querySelector<HTMLElement>('.duplicate-detail')!:viewport);groupList.setActive(showing()&&(!narrow.matches||detailOpen));}
 };
 const showGroup=(group:number,reveal=false)=>{
  if(!showing()||report?.kind!=='duplicates'||!resultList)return;
  const value=resultList.get(group);if(!value){resultList.choose(group);return;}
  if(selectedGroup!==group){
   const previous=locations.get(report.id),current=report;
   selectedGroup=group;groupList?.dispose();q('tool-group-files').replaceChildren();
   q('tool-group-title').textContent='重复组中的文件 · '+Number(value.files).toLocaleString()+' 份';
   groupList=new PagedResultList(q('tool-group-files'),{count:Number(value.files),pageSize:current.pageSize,estimate:78,label:'重复组中的文件',read:page=>api.fileToolsPage(current.id,page,group),error:toast,
    markup:file=>'<div class="tool-file-row"><span class="tool-file-icon" data-file-icon="'+esc(file.path)+'">'+icon('file')+'</span><div><strong>'+esc(String(file.path).split(/[\\/]/).pop())+'</strong><small>'+esc(file.path)+'</small></div>'+pathActions(String(file.path))+'</div>',
    activate:file=>{void api.preview(String(file.path)).catch(toast);}});
   if(previous?.group===group&&previous.detail)groupList.restore(previous.detail);
   resultList.refresh();
  }
  if((reveal||openOnGroup)&&narrow.matches){openOnGroup=false;remember();panel.classList.add('detail-open');viewport.scrollTop=0;}
  syncLists();docking.refresh();
  if(reveal&&narrow.matches)requestAnimationFrame(()=>{if(showing())q('tool-group-files').focus({preventScroll:true});});
 };
 const display=async(next?:FileToolReport)=>{
  if(!showing()){remember();report=next;viewDirty=true;return;}
  remember();resultList?.dispose();groupList?.dispose();resultList=groupList=undefined;selectedGroup=undefined;openOnGroup=false;
  report=next;renderedReportId=next?.id||'';viewDirty=false;progressTitle();panel.classList.remove('detail-open');
  if(!next){panel.innerHTML='<div class="tool-empty">'+icon(tab==='rename'?'rename':tab==='diff'?'braces':'search')+'<h3>'+(tab==='documents'?'搜索文档中的内容':'选择范围后开始')+'</h3><p>'+(tab==='documents'?'首次提取正文，后续查询使用本地索引。':'任务在后台执行，可随时停止。')+'</p></div>';return;}
  if(!next.count){panel.innerHTML='<div class="tool-empty">'+icon('check')+'<h3>'+esc(next.summary)+'</h3><p>'+(next.issueCount?'部分项目未完成，可查看上方详情。':'任务已完成。')+'</p></div>';return;}
  panel.innerHTML='<div class="tool-result-layout '+(next.kind==='duplicates'?'with-detail':'')+'"><div class="tool-result-scroll"><div id="tool-result-list"></div></div>'+(next.kind==='duplicates'?'<aside class="duplicate-detail"><div class="tool-group-heading"><h3 id="tool-group-title">重复组中的文件</h3><button id="tool-group-back" class="quiet" type="button">'+icon('back')+'返回重复组</button></div><div id="tool-group-files"></div></aside>':'')+'</div>';
  resultList=new PagedResultList(q('tool-result-list'),{count:next.count,pageSize:next.pageSize,estimate:next.kind==='document-search'?180:next.kind==='diff'?200:78,label:next.summary,read:page=>api.fileToolsPage(next.id,page),markup:rowHTML,error:toast,
   selected:(row)=>{if(next.kind==='duplicates')showGroup(row.id);},
   activate:row=>{if(next.kind==='duplicates')showGroup(row.id,true);else if(row.path)void api.preview(String(row.path)).catch(toast);},
   decorate:(row,value)=>{
    const group=row.querySelector<HTMLButtonElement>('[data-group]');if(group){const active=selectedGroup===value.id;if(group.dataset.active!==String(active)){group.dataset.active=String(active);group.setAttribute('aria-pressed',String(active));group.tabIndex=active?0:-1;}}
    const checkbox=row.querySelector<HTMLInputElement>('[data-rename-id]');if(checkbox&&!checkbox.disabled)checkbox.checked=selected(value.id);
   }});
  syncLists();const saved=locations.get(next.id);if(saved){resultList.restore(saved.main);openOnGroup=saved.detailOpen;}
  if(next.kind==='duplicates')action('tool-group-back',()=>{panel.classList.remove('detail-open');syncLists();resultList?.choose(selectedGroup||0,true);docking.refresh();});
  docking.refresh();selection();
 };
 new ResizeObserver(()=>{if(showing())syncLists();}).observe(viewport);
 new MutationObserver(()=>{if(showing())syncLists();}).observe(panel,{attributes:true,attributeFilter:['class']});
 narrow.addEventListener('change',()=>{if(showing())syncLists();});
 const run=async(task:FileToolTask)=>{
  const owner=key(task.kind),requestedRename=renameRevision,requestedQuery=queryRevision;
  const requestedScope=task.kind==='document-index'||task.kind==='document-search'?task.roots[0].toLowerCase()+':'+Boolean(task.recursive):'';
  if(active.has(owner))throw Error('请先停止当前任务');
  active.set(owner,task.kind);progress.set(owner,{id:'',kind:task.kind,phase:'准备中',completed:0,total:0});updateButtons();renderProgress();
  try{
   const next=await api.fileToolsRun(task);
   const current=task.kind==='duplicates'?task.roots[0].toLowerCase()===value('duplicates-root').toLowerCase()&&task.recursive===checked('duplicates-recursive'):task.kind!=='document-search'||requestedQuery===queryRevision&&requestedScope===scopeKey()&&task.query===value('documents-query');
   if(current)reports.set(owner,next);
   if(task.kind==='rename-preview'){autoPreview=true;planFresh=requestedRename===renameRevision;only=null;excluded.clear();if(planFresh)previewWork.clear();else previewWork.request();}
   if(task.kind==='rename-apply'){lastReceipt=next.receipt||'';planFresh=false;}
   if(task.kind==='rename-undo')lastReceipt='';
   if(task.kind==='document-index'){indexedScope=requestedScope;documentIndexed=requestedScope===scopeKey();indexReport=next;renderDocumentStatus();}
   if(task.kind==='document-search'&&current)documentWork.clear();
   if(tab===owner&&current)await display(next);
   return next;
  }finally{active.delete(owner);progress.delete(owner);updateButtons();previewWork.sync();documentWork.sync();}
 };
 action('rename-open-window',()=>api.openFileAction('rename',value('rename-paths').split(/\r?\n/).map(p=>p.trim()).filter(Boolean)));
 const renameTask=():FileToolTask=>({kind:'rename-preview',paths:value('rename-paths').split(/\r?\n/).map(p=>p.trim()).filter(Boolean),recursive:checked('rename-recursive'),selectedOnly:checked('rename-selected'),files:checked('rename-files'),folders:checked('rename-folders'),options:{...defaultRename(),search:input('rename-search').value,replace:input('rename-replace').value,regex:checked('rename-regex'),caseSensitive:checked('rename-case'),all:checked('rename-all'),target:value('rename-target') as RenameOptions['target'],caseMode:value('rename-case-mode') as RenameOptions['caseMode'],enumerate:checked('rename-enumerate'),start:Number(value('rename-start')),increment:Number(value('rename-increment')),padding:Number(value('rename-padding'))}});
 const scopeKey=()=>value('documents-root').toLowerCase()+':'+checked('documents-recursive');
 const renderDocumentStatus=()=>{
  if(!showing())return;
  const current=documentIndexed&&indexedScope===scopeKey()?indexReport:undefined;
  q('documents-index-state').textContent=current?current.summary+(current.issueCount?' · '+current.issueCount+' 项未完成':''):documentIndexed?'本地正文索引已就绪':'选择范围后首次搜索会建立本地正文索引';
  q('documents-issues').hidden=!current?.issueCount;
 };
 const renderProgress=()=>{
  if(!showing())return;const current=progress.get(tab);
  if(!current||active.get(tab)!==current.kind)return;
  q('tool-phase').textContent=current.phase;
  q('tool-count').textContent=current.total?`${current.completed.toLocaleString()} / ${current.total.toLocaleString()}`:current.completed?current.completed.toLocaleString():'';
  q('tool-current-path').textContent=current.path||'';
 };
 const indexDocuments=()=>run({kind:'document-index',roots:root('documents-root'),recursive:checked('documents-recursive'),extensions:''});
 const queryDocuments=async()=>{
  if(!value('documents-query')||active.has('documents'))return;
  documentWork.clear();const scope=scopeKey();
  if(!documentIndexed||indexedScope!==scope)await indexDocuments();
  if(scope!==scopeKey()||!value('documents-query'))return;
  await run({kind:'document-search',roots:root('documents-root'),query:value('documents-query'),recursive:checked('documents-recursive')});
 };
 const changeTab=async(next:ToolTab)=>{viewport.scrollTop=0;tab=next;previewWork.sync();documentWork.sync();for(const [id]of tabs){q('tool-pane-'+id).hidden=id!==next;q('tool-tab-'+id).classList.toggle('selected',id===next);q('tool-tab-'+id).setAttribute('aria-selected',String(id===next));}updateButtons();renderDocumentStatus();renderProgress();await display(reports.get(next));};
 document.querySelectorAll<HTMLElement>('[data-tool-tab]').forEach(b=>b.onclick=()=>{void changeTab(b.dataset.toolTab as ToolTab).catch(toast);});
 action('tool-run',async()=>{if(tab==='duplicates')await run({kind:'duplicates',roots:root('duplicates-root'),recursive:checked('duplicates-recursive'),minBytes:Number(value('duplicates-min'))*1024*1024,extensions:value('duplicates-types')});else if(tab==='diff')await run({kind:'diff',left:value('diff-left'),right:value('diff-right'),mode:diffMode,ignoreWhitespace:checked('file-diff-ignore-space'),encoding:value('diff-encoding')});else if(tab==='rename')await run(renameTask());else{await indexDocuments();if(value('documents-query'))await queryDocuments();}});action('tool-stop',()=>{if(tab==='documents')documentWork.clear();if(tab==='rename')previewWork.clear();return api.fileToolsCancel(active.get(tab));});
 document.querySelectorAll<HTMLElement>('[data-tool-folder]').forEach(b=>b.onclick=()=>{void api.pickDirectory(initialPickerPath(value(b.dataset.toolFolder!))).then(path=>{if(path){input(b.dataset.toolFolder!).value=path;input(b.dataset.toolFolder!).dispatchEvent(new Event('change',{bubbles:true}));}}).catch(toast);});
 const documentScopeEdited=()=>{documentIndexed=false;queryRevision++;documentWork.clear();renderDocumentStatus();};
 for(const id of ['duplicates-root','documents-root','rename-paths'])input(id).addEventListener('change',()=>{localStorage.setItem('tool-'+id,value(id));if(id==='documents-root')documentScopeEdited();});
 document.querySelectorAll<HTMLButtonElement>('[data-diff-mode]').forEach(b=>b.onclick=()=>{diffMode=b.dataset.diffMode as typeof diffMode;document.querySelectorAll<HTMLElement>('[data-diff-mode]').forEach(node=>{node.classList.toggle('selected',node===b);node.setAttribute('aria-pressed',String(node===b));});});for(const side of ['left','right'])action('diff-'+side+'-pick',async()=>{const initial=initialPickerPath(value('diff-'+side));const path=await(diffMode==='file'?api.pickFile(initial):api.pickDirectory(initial));if(path)input('diff-'+side).value=path;});
 const addRename=(path:string)=>{input('rename-paths').value+=(value('rename-paths')?'\n':'')+path;input('rename-paths').dispatchEvent(new Event('change',{bubbles:true}));};action('rename-add-file',async()=>{const path=await api.pickFile();if(path)addRename(path);});action('rename-add-folder',async()=>{const path=await api.pickDirectory();if(path)addRename(path);});q('rename-paths').addEventListener('dragover',e=>e.preventDefault());q('rename-paths').addEventListener('drop',e=>{e.preventDefault();for(const file of e.dataTransfer?.files||[]){const path=api.droppedFile(file);if(path)addRename(path);}});
 const previewWork=new DeferredWork(300,()=>autoPreview&&moduleActive&&tab==='rename'&&isWindowVisible()&&!active.has('rename'),async()=>{await run(renameTask());},toast);
 const documentWork=new DeferredWork(220,()=>showing()&&tab==='documents'&&documentIndexed&&indexedScope===scopeKey()&&!!value('documents-query')&&!active.has('documents'),queryDocuments,toast);
 const editedValues=new WeakMap<Element,string>();
 const controlValue=(node:Element)=>{const control=node as HTMLInputElement;return control.type==='checkbox'?String(control.checked):String(control.value);};
 const renameEdited=(event:Event)=>{if(!(event.target instanceof Element)||!event.target.closest('.rename-config'))return;const next=controlValue(event.target);if(editedValues.get(event.target)===next)return;editedValues.set(event.target,next);planFresh=false;renameRevision++;updateButtons();if(autoPreview)previewWork.request();};q('tool-pane-rename').addEventListener('input',renameEdited);q('tool-pane-rename').addEventListener('change',renameEdited);input('documents-recursive').onchange=documentScopeEdited;
 input('rename-select-all').onchange=()=>{only=input('rename-select-all').checked?null:new Set();excluded.clear();document.querySelectorAll<HTMLInputElement>('[data-rename-id]:not(:disabled)').forEach(e=>e.checked=only===null);selection();};
 action('rename-apply',async()=>{const current=reports.get('rename');if(!planFresh||!current||current.kind!=='rename-preview')return;const ids=only?[...only]:undefined;const count=only?only.size:current.stats.changes-excluded.size;if(!count)return;if(!await confirmDialog({title:'执行重命名',message:`将重命名 ${count} 个项目。目标存在时不会覆盖；完成后可以撤销。`,confirm:'重命名'}))return;await run({kind:'rename-apply',report:current.id,ids,excluded:[...excluded]});});
 action('rename-undo',async()=>{if(!lastReceipt||!await confirmDialog({title:'撤销上次重命名',message:'恢复上次操作的原名称。已被替换的文件或同名目标会停止撤销。',confirm:'撤销重命名'}))return;await run({kind:'rename-undo',receipt:lastReceipt});});
 action('documents-issues',async()=>{if(indexReport)await confirmDialog({title:'未完成的文档',message:indexReport.issues.map(i=>i.path+'\n'+i.error).join('\n\n'),confirm:'知道了'});});action('documents-search',queryDocuments);input('documents-query').onkeydown=e=>{if(e.key==='Enter')void queryDocuments().catch(toast);};
 input('documents-query').oninput=()=>{
  queryRevision++;
  if(!value('documents-query')){documentWork.clear();reports.delete('documents');if(active.get('documents')==='document-search')void api.fileToolsCancel('document-search').catch(()=>{});if(tab==='documents')void display().catch(toast);return;}
  documentWork.request();
 };
 q('tool-results').addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.dataset.renameId!==undefined){const id=Number(input.dataset.renameId);if(only){if(input.checked)only.add(id);else only.delete(id);}else if(input.checked)excluded.delete(id);else excluded.add(id);selection();}});
 q('tool-results').addEventListener('click',e=>{const target=e.target instanceof Element?e.target.closest<HTMLElement>('[data-group],[data-tool-preview],[data-tool-reveal],[data-tool-copy]'):null;if(!target)return;void(async()=>{if(target.dataset.group!==undefined)return showGroup(Number(target.dataset.group),true);if(target.dataset.toolPreview)return api.preview(target.dataset.toolPreview);if(target.dataset.toolReveal)return api.revealFile(target.dataset.toolReveal);if(target.dataset.toolCopy){await api.copyText(target.dataset.toolCopy);toast('已复制路径');}})().catch(toast);});
 action('tool-issues',async()=>{if(!report)return;await confirmDialog({title:`${report.issueCount} 项未完成`,message:report.issues.map(i=>i.path+'\n'+i.error).join('\n\n')+(report.issueCount>report.issues.length?'\n仅列出前 100 项。':''),confirm:'知道了'});});
 api.onFileToolsProgress(p=>{const owner=key(p.kind);if(active.get(owner)!==p.kind)return;progress.set(owner,p);if(owner===tab)renderProgress();});
 void api.fileToolsHistory().then(history=>{lastReceipt=history.find(r=>r.kind==='rename-apply'&&r.receipt)?.receipt||'';const indexed=history.find(r=>r.kind==='document-index'&&r.scope?.[0].toLowerCase()===value('documents-root').toLowerCase()&&Boolean(r.stats.recursive)===checked('documents-recursive'));documentIndexed=!!indexed;if(indexed){indexedScope=scopeKey();indexReport=indexed;}updateButtons();renderDocumentStatus();documentWork.sync();}).catch(()=>{});customControls(q('page-tools'));updateButtons();
 const syncView=()=>{
  const next=showing();
  if(visible!==next){
   visible=next;
   if(!next){remember();resultList?.setActive(false);groupList?.setActive(false);}
   else{
    updateButtons();selection();renderDocumentStatus();renderProgress();
    if(viewDirty)void display(report).catch(toast);
    else {syncLists();const saved=report&&locations.get(report.id);if(saved&&!panel.classList.contains('viewport-docked'))resultList?.restore(saved.main);hydrateFileIcons(q('tool-results'),showing);}
   }
  }
  previewWork.sync();documentWork.sync();
 };
 onWindowVisibility(syncView);
 return{activate(value:boolean){moduleActive=value;syncView();},openSelection:async(paths:string[])=>{input('rename-paths').value=paths.join('\n');input('rename-selected').checked=paths.length>0;input('rename-folders').checked=paths.length>0;input('rename-recursive').checked=false;reports.delete('rename');planFresh=false;renameRevision++;autoPreview=false;previewWork.clear();await changeTab('rename');if(paths.length)await run(renameTask());},openFolder:async(path:string)=>{
  if(value('duplicates-root').toLowerCase()!==path.toLowerCase())reports.delete('duplicates');
  for(const id of ['duplicates-root','documents-root']){input(id).value=path;input(id).dispatchEvent(new Event('change',{bubbles:true}));}
  await changeTab('duplicates');
 },select:async(next:ToolTab,id?:string)=>{if(id){const item=(await api.fileToolsHistory()).find(r=>r.id===id);if(item)reports.set(next,item);}await changeTab(next);}};
}
