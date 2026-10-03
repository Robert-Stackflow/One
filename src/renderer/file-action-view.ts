import {fileToolsPage,setupFileTools} from './file-tools-view';
import {locksmithCard,setupLocksmith} from './locksmith-view';
import {windowControls,setupChrome} from './chrome';
import {customControls} from './controls';
import {api,q,icon,toast} from './ui';
import './file-action.css';
export async function renderFileAction(){
 const target=await api.fileActionData(),rename=target.tool==='rename',title=rename?'批量重命名':'文件占用';
 document.body.classList.add('file-action-window',rename?'file-action-rename':'file-action-locksmith');
 q('app').innerHTML=`<div class="file-action-shell"><header class="file-action-header drag-region"><div class="file-action-brand">${icon(rename?'rename':'locksmith')}<span>${title}</span><small>One</small></div><div class="spacer"></div>${windowControls()}</header><main class="file-action-content"><section class="page" id="page-${rename?'tools':'locksmith'}">${rename?fileToolsPage():locksmithCard()}</section></main><div class="toast-layer"><div id="toast" class="toast" hidden role="status"></div></div></div>`;
 if(rename){
  const page=q('page-tools'),pane=q('tool-pane-rename'),config=pane.querySelector<HTMLElement>('.rename-config')!,rules=config.querySelector<HTMLElement>('.rename-rules')!,scope=config.querySelector<HTMLElement>('.rename-scope')!,format=q('rename-format-options');
  const details=document.createElement('details');details.className='file-action-scope';details.setAttribute('name','rename-settings');format.setAttribute('name','rename-settings');details.open=!target.paths.length;details.innerHTML=`<summary><span>项目与范围</span><small id="file-action-scope-count">${target.paths.length} 个项目</small>${icon('chevron-down')}</summary>`;details.append(scope);config.replaceChildren(rules,format,details);
  const scopeOptions=scope.querySelector('.rename-scope-options')!,selected=q<HTMLInputElement>('rename-selected');selected.closest('label')!.hidden=true;q('rename-scope-hint').remove();q('rename-paths').removeAttribute('aria-describedby');
  const mode=document.createElement('label');mode.className='tool-field file-action-scope-mode';mode.innerHTML='<span>处理范围</span><select id="rename-scope-mode" aria-label="处理范围"><option value="selection">所选项目</option><option value="contents">文件夹内的项目</option></select>';scopeOptions.before(mode);
  const variableHint=format.querySelector('.rename-variable-hint')!,help=document.createElement('details');help.className='file-action-variable-help';help.innerHTML=`<summary>${icon('info')}变量</summary><dl><dt>序号</dt><dd><code>\${n}</code></dd><dt>序号位数</dt><dd><code>\${padding=3}</code></dd><dt>创建日期</dt><dd><code>$YYYY-$MM-$DD</code></dd><dt>正则分组</dt><dd><code>$1</code></dd></dl>`;variableHint.replaceWith(help);
  const preview=document.createElement('section');preview.className='file-action-results';preview.setAttribute('aria-label','名称预览');
  const caption=document.createElement('div');caption.className='file-action-preview-caption';caption.innerHTML='<h2>名称预览</h2>';
  const columns=document.createElement('div');columns.className='file-action-columns';columns.innerHTML='<span></span><span>原名称</span><span></span><span>新名称</span>';
  preview.append(caption,q('tool-progress'),page.querySelector('.tool-result-heading')!,columns,q('tool-results'));page.append(preview);
  const footer=document.createElement('footer');footer.className='file-action-footer';footer.append(pane.querySelector('.rename-actions')!);const toolbar=page.querySelector('.file-tools-toolbar')!;footer.querySelector('.rename-actions')!.insertBefore(toolbar,q('rename-apply'));page.append(footer);
  q('rename-apply').textContent='重命名';q('tool-run').classList.remove('primary');q('tool-run').textContent='刷新预览';q('tool-stop').hidden=true;
  const scopeCount=()=>{q('file-action-scope-count').textContent=q<HTMLTextAreaElement>('rename-paths').value.split(/\r?\n/).filter(p=>p.trim()).length+' 个项目';};q('rename-paths').addEventListener('input',scopeCount);q('rename-paths').addEventListener('change',scopeCount);
 }else{
  const page=q('page-locksmith'),card=q('file-lock-card'),sidebar=document.createElement('aside'),results=document.createElement('section'),footer=document.createElement('footer');
  sidebar.className='file-action-lock-targets';sidebar.innerHTML='<div class="file-action-preview-caption"><h2>检查目标</h2><div id="lock-target-actions"></div></div>';
  for(const id of ['lock-pick-file','lock-pick-folder']){const b=q(id);b.classList.add('icon-button','quiet');b.title=id==='lock-pick-file'?'添加文件':'添加文件夹';b.setAttribute('aria-label',b.title);b.innerHTML=icon(id==='lock-pick-file'?'file':'folder');sidebar.querySelector('#lock-target-actions')!.append(b);}
  const pathEntry=document.createElement('details');pathEntry.className='file-action-lock-path';pathEntry.innerHTML='<summary>输入路径</summary>';pathEntry.append(card.querySelector('.lock-target-input')!);sidebar.append(pathEntry,q('lock-targets'));
  results.className='file-action-lock-results';results.setAttribute('aria-label','占用进程');results.innerHTML=`<div class="file-action-preview-caption"><h2>占用进程</h2></div><div id="lock-empty" class="file-action-empty">${icon('locksmith')}<h3 id="lock-empty-title">添加文件或文件夹</h3></div>`;results.append(q('lock-results'),q('lock-summary'));
  footer.className='file-action-footer';footer.innerHTML='<div class="file-action-lock-status"></div><div class="spacer"></div>';footer.querySelector('div')!.append(q('lock-status'));footer.append(q('lock-cancel'),q('lock-scan'));card.hidden=true;page.append(sidebar,results,footer);q('lock-scan').innerHTML=icon('refresh')+'重新检查';q('lock-refresh').hidden=true;
 }
 setupChrome();customControls(q('app'));
 if(rename){const tools=setupFileTools(),mode=q<HTMLSelectElement>('rename-scope-mode'),selected=q<HTMLInputElement>('rename-selected'),recursive=q('rename-recursive').closest<HTMLElement>('label')!;const sync=()=>{mode.value=selected.checked?'selection':'contents';recursive.hidden=selected.checked;};mode.onchange=event=>{selected.checked=mode.value==='selection';selected.dispatchEvent(new Event('change',{bubbles:true}));sync();event.stopPropagation();};tools.activate(true);const opening=tools.openSelection(target.paths);sync();await opening;}
 else{const locks=setupLocksmith();locks.activate(true);if(target.paths.length)await locks.inspect(target.paths).catch(toast);}
}
