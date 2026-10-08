import {api,esc,icon} from './ui';
import {installFileDropOverlay} from './file-drop-overlay';
import type {ArchiveListing,ArchiveEncoding,ArchiveProgress} from '../shared/archive';
import './archive-view.css';

export function archivePage(){return `<div class="archive-workspace">
 <div class="archive-mode tabs" role="tablist" aria-label="压缩与解压"><button type="button" data-archive-mode="create" class="selected" aria-selected="true">创建压缩包</button><button type="button" data-archive-mode="browse" aria-selected="false">浏览与解压</button></div>
 <section class="archive-panel" data-archive-pane="create"><div class="archive-panel-title"><h2>创建压缩包</h2><span>可添加多个文件或文件夹</span></div>
  <div class="archive-input-group"><div class="archive-label-row"><label for="archive-sources">压缩内容</label><div><button id="archive-add-file" type="button">添加文件</button><button id="archive-add-folder" type="button">添加文件夹</button></div></div><textarea id="archive-sources" rows="4" placeholder="拖入文件或文件夹，也可以每行粘贴一个完整路径"></textarea></div>
  <div class="archive-fields archive-options"><label>压缩格式<select id="archive-format"><option value="zip">ZIP</option><option value="7z">7Z</option></select></label><label>压缩包位置<input id="archive-target" placeholder="选择保存位置或输入 .zip 路径"></label><button id="archive-target-pick" type="button">选择文件夹</button></div>
  <div class="archive-fields"><label>加密密码 <span>留空则不加密</span><input id="archive-create-password" type="password" autocomplete="new-password" placeholder="可选，使用 AES 加密"></label></div>
  <div class="archive-fields"><label>分卷大小（MB） <span>留空则创建单个压缩包</span><input id="archive-volume" type="number" min="1" max="65536" step="1" placeholder="例如 1024"></label></div>
  <div class="archive-actions"><p>创建后自动校验。已有文件不会被覆盖。</p><button id="archive-create" class="primary" type="button">创建压缩包</button></div>
 </section>
 <section class="archive-panel" data-archive-pane="browse" hidden><div class="archive-panel-title"><h2>浏览压缩包</h2><span>先查看内容，再选择解压</span></div>
  <div class="archive-fields"><label>压缩包<input id="archive-source" placeholder="选择 ZIP、7Z、RAR、TAR、GZ 或 XZ 文件，也可拖入压缩包"></label><button id="archive-open-pick" type="button">选择文件</button><button id="archive-open" type="button">打开</button></div>
  <div class="archive-fields archive-options"><label>旧文件名编码<select id="archive-encoding"><option value="0">自动</option><option value="437">CP437</option><option value="936">GBK / CP936</option><option value="932">Shift JIS / CP932</option><option value="950">Big5 / CP950</option><option value="65001">UTF-8</option></select></label><label>解压密码<input id="archive-password" type="password" autocomplete="off" placeholder="加密压缩包需要密码"></label></div>
  <div id="archive-list-head" class="archive-list-head" hidden><div><strong id="archive-count"></strong><span id="archive-comment"></span></div><button id="archive-test" type="button">测试完整性</button></div>
  <div id="archive-list" class="archive-list"><div class="archive-empty">选择压缩包后查看其中的内容</div></div><button id="archive-more" type="button" hidden>加载更多</button>
  <div class="archive-fields archive-destination"><label>解压到<input id="archive-parent" placeholder="选择目标文件夹"></label><button id="archive-parent-pick" type="button">选择文件夹</button></div>
  <div class="archive-fields"><label>解压方式<select id="archive-destination-mode"><option value="folder">解压到同名文件夹</option><option value="smart">智能解压</option></select></label></div>
  <div class="archive-actions"><p>智能解压时，单个顶层项目直接放入目标目录；多个项目放入同名文件夹。已有内容不会被覆盖。</p><button id="archive-extract-selected" type="button">解压选中项</button><button id="archive-extract-all" class="primary" type="button">全部解压</button></div>
 </section>
 <div id="archive-status" class="archive-status" role="status" hidden><span id="archive-status-text"></span><button id="archive-cancel" type="button" hidden>取消</button></div>
 </div>`;}

export function setupArchiveView(){
 const root=document.querySelector<HTMLElement>('#page-archive')!;
 const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 const field=(selector:string)=>find<HTMLInputElement>(selector).value.trim();
 let mode:'create'|'browse'='create',listing:ArchiveListing|undefined,busy=false,taskId='';
 const status=(message:string,running=false)=>{find('#archive-status').hidden=false;find('#archive-status-text').textContent=message;find('#archive-cancel').hidden=!running;};
 const setBusy=(value:boolean)=>{busy=value;for(const button of root.querySelectorAll<HTMLButtonElement>('button:not([data-archive-mode])'))button.disabled=value;find<HTMLButtonElement>('#archive-cancel').disabled=false;};
 const addPaths=(paths:string[])=>{const existing=field('#archive-sources').split(/\r?\n/).filter(Boolean),seen=new Set(existing.map(path=>path.toLowerCase()));for(const path of paths)if(path&&!seen.has(path.toLowerCase())){existing.push(path);seen.add(path.toLowerCase());}find<HTMLTextAreaElement>('#archive-sources').value=existing.join('\n');if(existing.length&&!field('#archive-target'))find<HTMLInputElement>('#archive-target').value=existing[0].replace(/[\\/][^\\/]+$/,'')+'\\'+existing[0].split(/[\\/]/).pop()+'.'+field('#archive-format');};
 const showMode=(next:'create'|'browse')=>{mode=next;for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]')){const selected=button.dataset.archiveMode===next;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));}for(const pane of root.querySelectorAll<HTMLElement>('[data-archive-pane]'))pane.hidden=pane.dataset.archivePane!==next;};
 for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]'))button.onclick=()=>showMode(button.dataset.archiveMode as typeof mode);
 const run=async<T>(work:()=>Promise<T>,success:(value:T)=>void)=>{if(busy)return;setBusy(true);status('正在处理…',true);try{const value=await work();success(value);}catch(error){status(error instanceof Error?error.message:String(error));}finally{taskId='';setBusy(false);}};
 const render=()=>{if(!listing)return;find('#archive-list-head').hidden=false;find('#archive-count').textContent=`${listing.total.toLocaleString()} 项`;
   find('#archive-comment').textContent=listing.comment?`备注：${listing.comment}`:'';
   const host=find('#archive-list');if(listing.offset===0)host.innerHTML='';
   host.insertAdjacentHTML('beforeend',listing.entries.map(entry=>`<label class="archive-entry"><input type="checkbox" value="${entry.index}"><span class="archive-entry-icon">${icon(entry.directory?'folder':'file')}</span><span class="archive-entry-name" title="${esc(entry.name)}">${esc(entry.name)}</span><span>${entry.encrypted?'已加密':''}</span><span>${entry.directory?'文件夹':(entry.size/1024).toLocaleString(undefined,{maximumFractionDigits:1})+' KB'}</span></label>`).join(''));
   find('#archive-more').hidden=listing.offset+listing.entries.length>=listing.total;
 };
 const load=async(offset=0)=>{const source=field('#archive-source');if(!source)return status('请先选择压缩包');if(offset===0){listing=undefined;find('#archive-list-head').hidden=true;find('#archive-more').hidden=true;find('#archive-list').innerHTML='<div class="archive-empty">正在读取压缩包…</div>';}await run(()=>api.archiveRun({operation:'list',path:source,offset,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding}),value=>{if(!('entries' in value))return;listing=value;if(offset===0&&!field('#archive-parent'))find<HTMLInputElement>('#archive-parent').value=source.replace(/[\\/][^\\/]+$/,'');render();status(`已读取 ${Math.min(offset+value.entries.length,value.total)} / ${value.total} 项`);});};
 find<HTMLButtonElement>('#archive-add-file').onclick=async()=>{const path=await api.pickFile();if(path)addPaths([path]);};
 find<HTMLButtonElement>('#archive-add-folder').onclick=async()=>{const path=await api.pickDirectory();if(path)addPaths([path]);};
 find<HTMLSelectElement>('#archive-format').onchange=()=>{const format=field('#archive-format'),target=find<HTMLInputElement>('#archive-target');target.placeholder=`选择保存位置或输入 .${format} 路径`;if(/\.(?:zip|7z)$/i.test(target.value))target.value=target.value.replace(/\.(?:zip|7z)$/i,'.'+format);};
 find<HTMLButtonElement>('#archive-target-pick').onclick=async()=>{const folder=await api.pickDirectory();if(folder)find<HTMLInputElement>('#archive-target').value=folder+'\\archive.'+field('#archive-format');};
 find<HTMLButtonElement>('#archive-create').onclick=()=>{const sources=field('#archive-sources').split(/\r?\n/).map(value=>value.trim()).filter(Boolean),target=field('#archive-target'),volume=field('#archive-volume'),format=field('#archive-format');if(!sources.length||!target)return status('请添加内容并填写压缩包位置');if(!target.toLowerCase().endsWith('.'+format))return status(`压缩包位置须以 .${format} 结尾`);if(volume&&(!/^\d+$/.test(volume)||Number(volume)<1||Number(volume)>65536))return status('分卷大小须为 1–65536 MB');void run(()=>api.archiveRun({operation:'create',path:target,sources,password:field('#archive-create-password'),volumeBytes:volume?Number(volume)*1024**2:0}),value=>{if('count' in value){status(`已创建压缩包：${value.path}`);void api.revealFile(value.path);}});};
 find<HTMLButtonElement>('#archive-open-pick').onclick=async()=>{const path=await api.pickFile();if(path){find<HTMLInputElement>('#archive-source').value=path;void load();}};
 find<HTMLButtonElement>('#archive-open').onclick=()=>void load();
 find<HTMLInputElement>('#archive-source').oninput=()=>{listing=undefined;find('#archive-list-head').hidden=true;find('#archive-more').hidden=true;find('#archive-list').innerHTML='<div class="archive-empty">点击“打开”查看压缩包内容</div>';};
 find<HTMLButtonElement>('#archive-more').onclick=()=>{if(listing)void load(listing.offset+listing.entries.length);};
 find<HTMLSelectElement>('#archive-encoding').onchange=()=>{if(field('#archive-source'))void load();};
 find<HTMLButtonElement>('#archive-parent-pick').onclick=async()=>{const folder=await api.pickDirectory();if(folder)find<HTMLInputElement>('#archive-parent').value=folder;};
 find<HTMLButtonElement>('#archive-test').onclick=()=>{const source=listing?.path;if(!source)return;void run(()=>api.archiveRun({operation:'test',path:source,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding}),value=>{if('count' in value)status(`校验完成：${value.count} 项`);});};
 const extract=(selected:number[])=>{if(!listing)return;const parent=field('#archive-parent');if(!parent)return status('请选择解压目标文件夹');void run(()=>api.archiveRun({operation:'extract',path:listing!.path,parent,destination:field('#archive-destination-mode') as 'folder'|'smart',selected,password:field('#archive-password'),encoding:Number(field('#archive-encoding')) as ArchiveEncoding}),value=>{if('count' in value){status(`已解压 ${value.count} 项到 ${value.path}`);void api.revealFile(value.path);}});};
 find<HTMLButtonElement>('#archive-extract-all').onclick=()=>extract([]);
 find<HTMLButtonElement>('#archive-extract-selected').onclick=()=>{const selected=[...root.querySelectorAll<HTMLInputElement>('.archive-entry input:checked')].map(input=>Number(input.value));if(!selected.length)return status('请先选择要解压的项目');extract(selected);};
 find<HTMLButtonElement>('#archive-cancel').onclick=()=>{if(taskId)void api.archiveCancel(taskId);};
 api.onArchiveProgress((value:ArchiveProgress)=>{taskId=value.id;status(`${value.operation==='create'?'正在压缩':value.operation==='extract'?'正在解压':value.operation==='prepare'?'正在打开压缩包':'正在校验'} · ${value.done} / ${value.total||'…'}`,true);});
 installFileDropOverlay(root,{placement:'host',spacious:true,title:'压缩与解压',detail:'拖入常见压缩包浏览，或拖入文件与文件夹创建压缩包',onDrop:paths=>{if(paths.length===1&&/\.(?:zip|7z|7z\.001|rar|r00|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i.test(paths[0])){showMode('browse');find<HTMLInputElement>('#archive-source').value=paths[0];void load();}else{showMode('create');addPaths(paths);}}});
 return {activate:(_active:boolean)=>{}};
}
