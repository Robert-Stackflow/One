import {q} from './ui';
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
