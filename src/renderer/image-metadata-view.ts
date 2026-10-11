import './image-convert.css';
import {api,esc,q,toast,errorMessage} from './ui';
import type {ImageMetadataOptions,ImageMetadataProgress} from '../shared/image-metadata';
import type {ImageConvertResult} from '../shared/image-convert';

const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;
const sizeOf=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;

export function imageMetadataPage(){return `<div class="image-convert-page image-metadata-page">
 <div class="image-convert-layout"><section class="settings-card image-convert-panel"><h3>图片与输出</h3>
 <div class="image-convert-picks"><button id="image-metadata-add" type="button">添加图片</button><button id="image-metadata-clear" type="button" class="quiet">清空列表</button><span id="image-metadata-count" aria-live="polite">尚未选择图片</span></div>
 <div id="image-metadata-files" class="image-convert-files" aria-label="待清理图片"></div>
 <div class="image-convert-destination"><label for="image-metadata-directory">输出文件夹</label><input id="image-metadata-directory" readonly placeholder="选择保存位置"><button id="image-metadata-pick-directory" type="button">选择文件夹</button></div>
 <div class="image-convert-actions"><button id="image-metadata-start" type="button">开始清理</button><button id="image-metadata-cancel" type="button" class="quiet" disabled>取消</button><button id="image-metadata-retry" type="button" class="quiet" hidden>重试失败项</button><span id="image-metadata-status" role="status" aria-live="polite"></span></div></section>
 <section class="settings-card image-convert-panel"><h3>清理设置</h3>
 <div class="image-convert-options image-metadata-options"><label class="image-convert-metadata"><input id="image-metadata-exif" type="checkbox" checked>移除 EXIF（含 GPS）</label><label class="image-convert-metadata"><input id="image-metadata-gps" type="checkbox" checked>移除 GPS</label><label class="image-convert-metadata"><input id="image-metadata-xmp" type="checkbox" checked>移除 XMP</label><label class="image-convert-metadata"><input id="image-metadata-iptc" type="checkbox" checked>移除 IPTC</label></div>
 <details class="tool-notes"><summary>格式与限制</summary><p class="image-convert-note">支持 PNG、JPEG、WebP、GIF、TIFF，每批最多 100 张，单张最大 100 MB。删除 EXIF 会同时删除其中的 GPS；只选 GPS 时，其他 EXIF 保留。输出后核验所选标签和 ICC。多帧图片含方向标记时将提示无法安全处理。</p></details>
 </section></div></div>`;}

export function setupImageMetadata(){
 const files=q<HTMLElement>('image-metadata-files'),count=q<HTMLElement>('image-metadata-count'),status=q<HTMLElement>('image-metadata-status'),directory=q<HTMLInputElement>('image-metadata-directory');
 const add=q<HTMLButtonElement>('image-metadata-add'),clear=q<HTMLButtonElement>('image-metadata-clear'),pick=q<HTMLButtonElement>('image-metadata-pick-directory'),start=q<HTMLButtonElement>('image-metadata-start'),cancel=q<HTMLButtonElement>('image-metadata-cancel'),retry=q<HTMLButtonElement>('image-metadata-retry');
 const exif=q<HTMLInputElement>('image-metadata-exif'),gps=q<HTMLInputElement>('image-metadata-gps'),xmp=q<HTMLInputElement>('image-metadata-xmp'),iptc=q<HTMLInputElement>('image-metadata-iptc');
 let paths:string[]=[],results=new Map<string,ImageConvertResult>(),running=false,current:string|undefined;
 const render=()=>{
  count.textContent=paths.length?`已选择 ${paths.length} 张图片`:'尚未选择图片';
  files.innerHTML=paths.length?paths.map(path=>{const result=results.get(path),state=result?.status==='done'?'已完成':result?.status==='error'?'失败':result?.status==='cancelled'?'已取消':path===current?'清理中':'待处理';return `<div class="image-convert-file"><div><strong title="${esc(path)}">${esc(nameOf(path))}</strong><small>${result?.before?sizeOf(result.before):''}${result?.after?` → ${sizeOf(result.after)}`:''}</small>${result?.message?`<small title="${esc(result.message)}">${esc(result.message)}</small>`:''}</div><span class="image-convert-file-state" data-state="${result?.status||''}">${state}</span>${result?.output?`<button type="button" data-image-reveal="${esc(path)}">显示文件</button>`:''}</div>`;}).join(''):'<p class="image-convert-empty">添加图片后可开始清理。</p>';
  start.disabled=running||!paths.length;add.disabled=running;clear.disabled=running;pick.disabled=running;cancel.disabled=!running;retry.hidden=running||![...results.values()].some(result=>result.status!=='done');retry.disabled=running;
  for(const input of [directory,exif,gps,xmp,iptc])input.disabled=running;
 };
 const progress=(value:ImageMetadataProgress)=>{if(!running)return;current=value.current;if(value.result){results.set(value.result.source,value.result);current=undefined;}status.textContent=`已处理 ${value.done} / ${value.total}`;render();};
 const run=async(selected:string[])=>{if(!selected.length)return;if(!directory.value){toast(Error('请先选择输出文件夹'));return;}const options:ImageMetadataOptions={removeExif:exif.checked,removeGps:gps.checked,removeXmp:xmp.checked,removeIptc:iptc.checked};if(!Object.values(options).some(Boolean)){toast(Error('请至少选择一类要移除的元数据'));return;}
  running=true;current=undefined;for(const path of selected)results.delete(path);render();status.textContent=`正在处理 0 / ${selected.length}`;
  try{const summary=await api.imageMetadataStart(selected,directory.value,options);for(const result of summary.results)results.set(result.source,result);const done=summary.results.filter(result=>result.status==='done').length,failed=summary.results.filter(result=>result.status==='error').length;status.textContent=summary.cancelled?`已取消，完成 ${done} 张`:failed?`完成 ${done} 张，失败 ${failed} 张`:`已完成 ${done} 张`;}catch(error){status.textContent=errorMessage(error);toast(error);}finally{running=false;current=undefined;render();}
 };
 add.onclick=()=>void api.imagePickFiles().then(chosen=>{const set=new Set(paths.map(path=>path.toLowerCase()));for(const path of chosen)if(!set.has(path.toLowerCase())&&paths.length<100){paths.push(path);set.add(path.toLowerCase());}render();if(chosen.length&&paths.length===100)status.textContent='每批最多 100 张图片';}).catch(toast);
 clear.onclick=()=>{paths=[];results.clear();current=undefined;status.textContent='';render();};pick.onclick=()=>void api.pickDirectory(directory.value||undefined).then(path=>{if(path)directory.value=path;}).catch(toast);
 start.onclick=()=>void run(paths);retry.onclick=()=>void run(paths.filter(path=>results.get(path)?.status!=='done'));cancel.onclick=()=>void api.imageMetadataCancel().catch(toast);
 files.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-image-reveal]');const output=button&&results.get(button.dataset.imageReveal||'')?.output;if(output)void api.revealFile(output).catch(toast);};
 const unsubscribe=api.onImageMetadataProgress(progress);render();return {dispose(){unsubscribe();if(running)void api.imageMetadataCancel();}};
}
