import {fileToolsPage,setupFileTools} from './file-tools-view';
import {locksmithCard,setupLocksmith,arrangeLocksmithLayout} from './locksmith-view';
import {windowControls,setupChrome} from './chrome';
import {customControls} from './controls';
import {setupRenameSidebar} from './rename-sidebar';
import {installFileDropOverlay} from './file-drop-overlay';
import {api,q,icon,toast} from './ui';
import './file-action.css';
export function arrangeRenameLayout(page:HTMLElement,standalone:boolean){
 const pane=q('tool-pane-rename'),preview=document.createElement('section');preview.className='file-action-results';preview.setAttribute('aria-label','名称预览');
 const caption=document.createElement('div');caption.className='file-action-preview-caption';caption.innerHTML='<h2>名称预览</h2>';
 const columns=document.createElement('div');columns.className='file-action-columns';columns.innerHTML='<span></span><span>原名称</span><span></span><span>新名称</span>';
 preview.append(caption,q('tool-progress'),page.querySelector('.tool-result-heading')!,columns,q('tool-results'));page.append(preview);
 const footer=document.createElement('footer');footer.className='file-action-footer';footer.append(pane.querySelector('.rename-actions')!);
 page.append(footer);
 if(standalone){const toolbar=page.querySelector('.file-tools-toolbar')!;footer.querySelector('.rename-actions')!.insertBefore(toolbar,q('rename-apply'));q('rename-apply').textContent='重命名';q('tool-run').classList.remove('primary');q('tool-run').textContent='刷新预览';q('tool-stop').hidden=true;}
}
export function wireRenameScopeMode(){const mode=q<HTMLSelectElement>('rename-scope-mode'),selected=q<HTMLInputElement>('rename-selected'),recursive=q('rename-recursive').closest<HTMLElement>('label')!;const sync=()=>{mode.value=selected.checked?'selection':'contents';recursive.hidden=selected.checked;};mode.onchange=event=>{selected.checked=mode.value==='selection';selected.dispatchEvent(new Event('change',{bubbles:true}));sync();event.stopPropagation();};selected.addEventListener('change',sync);sync();}
export async function renderFileAction(){
 const target=await api.fileActionData(),rename=target.tool==='rename',title=rename?'批量重命名':'文件占用';
 document.body.classList.add('file-action-window',rename?'file-action-rename':'file-action-locksmith');
 q('app').innerHTML=`<div class="file-action-shell"><header class="file-action-header drag-region"><div class="file-action-brand">${icon(rename?'rename':'locksmith')}<span>${title}</span><small>One</small></div><div class="spacer"></div>${windowControls()}</header><main class="file-action-content"><section class="page" id="page-${rename?'tools':'locksmith'}">${rename?fileToolsPage():locksmithCard()}</section></main><div class="toast-layer"><div id="toast" class="toast" hidden role="status"></div></div></div>`;
 let refreshSidebar:(()=>void)|undefined;
 if(rename){
  refreshSidebar=setupRenameSidebar(!!target.paths.length);arrangeRenameLayout(q('page-tools'),true);
 }else{
  arrangeLocksmithLayout(q('page-locksmith'));
 }
 setupChrome();customControls(q('app'));
 if(rename){const tools=setupFileTools();wireRenameScopeMode();tools.activate(true);installFileDropOverlay(q('app'),{title:'添加到批量重命名',detail:'松开以添加文件或文件夹',onDrop:paths=>tools.addPaths(paths)});const opening=tools.openSelection(target.paths);refreshSidebar?.();await opening;}
 else{const locks=setupLocksmith();locks.activate(true);installFileDropOverlay(q('app'),{title:'检查文件占用',detail:'松开以添加文件或文件夹并开始检查',onDrop:paths=>locks.addTargets(paths)});if(target.paths.length)await locks.inspect(target.paths).catch(toast);}
}
