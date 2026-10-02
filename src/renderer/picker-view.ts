import {dialogMarkup,openDialog,closeDialog} from './dialog';
import type {PickerData} from '../shared/types';
import {api,q,esc,icon,button,toast,action} from './ui';
import {windowControls,setupChrome} from './chrome';
import {customControls} from './controls';
const app=document.querySelector<HTMLDivElement>('#app')!;
export function renderPicker() {
  app.innerHTML = `<div class="picker-shell"><header class="picker-heading drag-region"><h2 id="picker-title"></h2>${windowControls()}</header><div class="picker-toolbar"><button id="picker-up" class="icon-button" aria-label="上级目录">${icon('back')}</button><input id="picker-path" aria-label="当前目录"><button id="picker-go">前往</button></div><div class="picker-content"><nav id="picker-drives" aria-label="磁盘"></nav><div id="picker-list" role="listbox" aria-label="文件与目录" tabindex="0"></div></div><footer class="picker-footer"><label id="picker-name-label">文件名<input id="picker-name" aria-label="文件名"></label><div class="picker-buttons"><span id="picker-status" role="status"></span>${button('picker-cancel','取消')}${button('picker-confirm','选择','',true)}</div></footer></div><div class="toast picker-toast" id="toast" hidden role="status"></div>${dialogMarkup({id:"overwrite-dialog",title:"文件已存在",closeId:"overwrite-close",body:`<p id="overwrite-name"></p>`,actions:`<button id="overwrite-cancel" autofocus>取消</button>${button('overwrite-confirm','替换文件','',true)}`})}`;
  setupChrome();
  let data: PickerData; let selected = ''; let revision = 0;
  const list = q('picker-list');
  const navigate = async (path?: string) => {
    const version=++revision; q('picker-status').textContent='正在读取…';
    try { const next=await api.pickerData(path); if(version!==revision)return;data=next; selected=''; q('picker-title').textContent=data.title; q<HTMLInputElement>('picker-path').value=data.path; q('picker-status').textContent=`${data.entries.length} 项`; q('picker-name-label').hidden=data.mode==='directory';q<HTMLInputElement>('picker-name').value=data.name; q('picker-confirm').textContent=data.mode==='save'?'保存':data.mode==='directory'?'选择此目录':'打开';
      q('picker-drives').replaceChildren(); for(const drive of data.drives){const button=document.createElement('button');button.className='drive-button'+(data.path.toLowerCase().startsWith(drive.toLowerCase())?' active':'');button.textContent=drive.slice(0,2);button.onclick=()=>void navigate(drive).catch(toast);q('picker-drives').append(button)}
      list.replaceChildren(); for(const entry of data.entries){const row=document.createElement('div');row.className='picker-entry';row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.setAttribute('aria-label',entry.name);row.innerHTML=`${icon(entry.directory?'folder':'file')}<span>${esc(entry.name)}</span><span class="entry-kind">${entry.directory?'文件夹':''}</span>`;
        const select=()=>{selected=entry.path;list.querySelectorAll('[role=option]').forEach(node=>{node.classList.toggle('selected',node===row);node.setAttribute('aria-selected',String(node===row))});if(!entry.directory)q<HTMLInputElement>('picker-name').value=entry.name;};
        row.addEventListener('click',select);row.addEventListener('dblclick',()=>{select();if(entry.directory)void navigate(entry.path).catch(toast);else void confirm().catch(toast)});list.append(row);
      }
      if(!data.entries.length)list.innerHTML='<div class="table-empty">目录为空</div>';
    } catch(error){q('picker-status').textContent='目录读取失败';throw error}
  };
  const target = () => data.mode==='directory' ? (selected || data.path) : data.path.replace(/[\\/]$/,'')+'\\'+q<HTMLInputElement>('picker-name').value;
  const confirm = async (overwrite=false) => { if(!data)return;if(data.mode!=='directory'&&!q<HTMLInputElement>('picker-name').value.trim())return toast('请输入或选择文件名'); const result=await api.pickerChoose(target(),overwrite); if(result.overwrite){q('overwrite-name').textContent='替换 '+q<HTMLInputElement>('picker-name').value+'？';openDialog(q<HTMLDialogElement>('overwrite-dialog'));} };
  action('picker-go',()=>navigate(q<HTMLInputElement>('picker-path').value));action('picker-up',()=>data&&navigate(data.parent));action('picker-cancel',()=>api.closeWindow());action('picker-confirm',()=>confirm());
  action('overwrite-cancel',()=>closeDialog(q<HTMLDialogElement>('overwrite-dialog')));action('overwrite-confirm',()=>confirm(true));
  q('picker-path').addEventListener('keydown',event=>{if(event.key==='Enter')void navigate(q<HTMLInputElement>('picker-path').value).catch(toast)});
  q('picker-name').addEventListener('keydown',event=>{if(event.key==='Enter')void confirm().catch(toast)});
  list.addEventListener('keydown',event=>{const index=data?.entries.findIndex(entry=>entry.path===selected)??-1;if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const next=Math.max(0,Math.min(data.entries.length-1,index+(event.key==='ArrowDown'?1:-1)));(list.children[next] as HTMLElement)?.click();(list.children[next] as HTMLElement)?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'&&index>=0){event.preventDefault();const entry=data.entries[index];if(entry.directory)void navigate(entry.path).catch(toast);else void confirm().catch(toast)}});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!q<HTMLDialogElement>('overwrite-dialog').open)void api.closeWindow()});void navigate().catch(toast);
}
