import {setupLockPathPopover} from './lock-path-popover';
import {q,icon} from './ui';
import './file-action.css';

export function arrangeLocksmithLayout(page:HTMLElement){
 const card=q('file-lock-card'),sidebar=document.createElement('aside'),results=document.createElement('section'),footer=document.createElement('footer');
 sidebar.className='file-action-lock-targets';sidebar.innerHTML='<div class="file-action-preview-caption"><h2>检查目标</h2><div id="lock-target-actions"></div></div>';
 for(const id of ['lock-pick-file','lock-pick-folder','lock-open-window']){const b=q(id);b.classList.add('icon-button','quiet');b.title=id==='lock-pick-file'?'添加文件':id==='lock-pick-folder'?'添加文件夹':'独立窗口';b.setAttribute('aria-label',b.title);b.innerHTML=icon(id==='lock-pick-file'?'file':id==='lock-pick-folder'?'folder':'open');sidebar.querySelector('#lock-target-actions')!.append(b);}
 setupLockPathPopover(sidebar.querySelector('#lock-target-actions')!,card.querySelector<HTMLElement>('.lock-target-input')!);sidebar.append(q('lock-targets'));
 results.className='file-action-lock-results';results.setAttribute('aria-label','相关进程');results.innerHTML=`<div class="file-action-preview-caption"><h2>相关进程</h2></div><div id="lock-empty" class="file-action-empty"><span class="lock-empty-symbol">${icon('locksmith')}</span><h3 id="lock-empty-title">添加文件或文件夹</h3><div id="lock-empty-progress" class="lock-empty-progress" role="progressbar" aria-label="占用检查进度" hidden><span id="lock-empty-progress-fill"></span></div></div>`;results.append(q('lock-results'));
 footer.className='file-action-footer';footer.innerHTML='<div class="file-action-lock-status"></div>';footer.querySelector('div')!.append(q('lock-status'),q('lock-summary'));footer.append(q('lock-cancel'),q('lock-scan'));card.hidden=true;page.append(sidebar,results,footer);q('lock-scan').innerHTML=icon('refresh')+'重新检查';q('lock-refresh').hidden=true;
}
