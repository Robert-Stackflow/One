import {isAlzPath} from '../shared/archive-actions';
import {api,esc,icon,size} from './ui';
import {supportsArchivePasswordEncoding} from '../shared/archive-options';
import {customControls} from './controls';
import type {ArchiveBrowse,ArchiveEncoding,ArchiveListing,ArchivePasswordEncoding} from '../shared/archive';
import './archive-preview.css';

/** Bounded, read-only browsing through the same archive engine as the main page. */
export function renderArchivePreview(host:HTMLElement,path:string){
 const root=document.createElement('div');root.className='archive-preview';
 root.innerHTML=`<header class="archive-preview-toolbar"><button data-up class="icon-button quiet" aria-label="上一级包内目录">${icon('up')}</button><span data-location>压缩包</span><input data-search type="search" aria-label="搜索包内文件" placeholder="搜索包内文件"><button data-search-run class="icon-button quiet" aria-label="搜索">${icon('search')}</button><button data-open type="button">打开解压</button></header>
 <details class="archive-preview-options"><summary>密码与文件名编码</summary><div><input data-password type="password" autocomplete="off" placeholder="解压密码" aria-label="解压密码"><select id="preview-archive-encoding" aria-label="文件名编码"><option value="0">自动识别文件名</option><option value="936">GBK / CP936</option><option value="437">CP437</option><option value="932">Shift JIS / CP932</option><option value="949">韩文 / CP949</option><option value="950">Big5 / CP950</option><option value="65001">UTF-8</option></select><select id="preview-archive-password-encoding" aria-label="ZIP / ZIPX 密码编码"><option value="65001">密码 UTF-8</option><option value="0">密码 Windows 系统编码</option><option value="936">密码 GBK / CP936</option><option value="932">密码 Shift JIS</option><option value="949">韩文 / CP949</option><option value="950">密码 Big5</option><option value="437">密码 CP437</option></select><button data-apply>应用</button></div></details>
 ${isAlzPath(path)?'<p class="archive-preview-options">ALZ 的“自动”使用韩文 CP949；密码沿用本次文件名编码。</p>':''}
 ${/\.egg$/i.test(path)?'<p class="archive-preview-options">EGG 的“自动”使用包内声明的文件名编码；密码使用 UTF-8。</p>':''}
 <div data-error class="archive-preview-error" role="alert" hidden></div><div data-list class="archive-preview-list" aria-label="包内文件"></div><footer><span data-count></span><button data-previous>上一页</button><button data-next>下一页</button></footer>
 <div data-loading class="archive-preview-loading" hidden><span data-progress role="status">正在读取压缩包…</span><button data-stop>停止</button></div>`;
 host.append(root);customControls(root);
 const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 let disposed=false,busy=false,task='',listing:ArchiveListing|undefined,query:ArchiveBrowse={directory:'',search:'',flat:false};
 const controls=()=>{for(const control of root.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input'))control.disabled=busy;find<HTMLButtonElement>('[data-stop]').disabled=false;find<HTMLButtonElement>('[data-up]').disabled=busy||!query.directory;find<HTMLButtonElement>('[data-previous]').hidden=!listing||!listing.offset;find<HTMLButtonElement>('[data-next]').hidden=!listing||listing.offset+listing.entries.length>=(listing.matched??listing.total);};
 const paint=()=>{if(!listing)return;
  const count=listing.matched??listing.total;
  find('[data-location]').textContent=query.directory||'压缩包';find('[data-location]').title=query.directory||path;
  find('[data-count]').textContent=count?`${listing.offset+1}–${listing.offset+listing.entries.length} / ${count.toLocaleString()} 项`:'没有匹配的项目';
  find('[data-list]').innerHTML=listing.entries.length?listing.entries.map((entry,index)=>`<${entry.directory?'button':'div'} class="archive-preview-entry"${entry.directory?` type="button" data-directory="${index}"`:''}>${icon(entry.directory?'folder':'file')}<span title="${esc(entry.name)}">${esc(query.search?entry.name:entry.name.slice(query.directory.length).replace(/\/$/,''))}</span><small>${entry.encrypted?'已加密 · ':''}${entry.directory?'文件夹':entry.sizeKnown===false?'未知大小':size(entry.size)}</small></${entry.directory?'button':'div'}>`).join(''):'<div class="archive-preview-empty">此目录没有文件</div>';
 };
 const load=async(offset=0)=>{if(disposed||busy)return;busy=true;task=crypto.randomUUID();const id=task;
  find('[data-loading]').hidden=false;find('[data-error]').hidden=true;find('[data-progress]').textContent='正在读取压缩包…';controls();
  try{const value=await api.previewArchive({path,offset,browse:query,password:find<HTMLInputElement>('[data-password]').value,encoding:Number((find('#preview-archive-encoding') as HTMLSelectElement).value) as ArchiveEncoding,passwordEncoding:supportsArchivePasswordEncoding(path)?Number((find('#preview-archive-password-encoding') as HTMLSelectElement).value) as ArchivePasswordEncoding:65001},id);
   if(disposed||id!==task)return;listing=value;query=value.browse??query;paint();
  }catch(error){if(disposed||id!==task)return;find('[data-error]').textContent=String(error instanceof Error?error.message:error).replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^(?:Error|ArchiveFailure):\s*/,'');find('[data-error]').hidden=false;
  }finally{if(!disposed&&id===task){task='';busy=false;find('[data-loading]').hidden=true;controls();}}
 };
 find('#preview-archive-password-encoding').hidden=!supportsArchivePasswordEncoding(path);
 const search=()=>{if(busy)return;query={...query,search:find<HTMLInputElement>('[data-search]').value.trim()};void load();};
 find('[data-search-run]').onclick=search;find<HTMLInputElement>('[data-search]').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();search();event.stopPropagation();}};
 find('[data-apply]').onclick=()=>void load();
 find('[data-up]').onclick=()=>{query={...query,directory:query.directory.replace(/[^/]+\/$/,''),search:''};find<HTMLInputElement>('[data-search]').value='';void load();};
 find('[data-list]').onclick=event=>{if(busy||!listing)return;const button=(event.target as Element).closest<HTMLElement>('[data-directory]');if(!button)return;const entry=listing.entries[Number(button.dataset.directory)];query={directory:entry.name.replace(/\/?$/,'/'),search:'',flat:false};find<HTMLInputElement>('[data-search]').value='';void load();};
 find('[data-previous]').onclick=()=>void load(Math.max(0,(listing?.offset??0)-200));find('[data-next]').onclick=()=>void load((listing?.offset??0)+200);
 find('[data-open]').onclick=()=>void api.openFile(path).catch(error=>{find('[data-error]').textContent=String(error);find('[data-error]').hidden=false;});
 find('[data-stop]').onclick=()=>{const id=task;if(!id)return;find<HTMLButtonElement>('[data-stop]').disabled=true;find('[data-progress]').textContent='正在停止…';void api.archiveCancel(id).catch(()=>{if(!disposed&&task===id){find<HTMLButtonElement>('[data-stop]').disabled=false;find('[data-progress]').textContent='停止未完成，可重试';}});};
 void load();
 return ()=>{disposed=true;if(task)void api.archiveCancel(task).catch(()=>{});root.remove();};
}
