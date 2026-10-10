import './image-convert.css';
import {api,esc,q,toast,errorMessage} from './ui';
import type {ImageConvertFormat,ImageConvertOptions,ImageConvertProgress,ImageConvertResult} from '../shared/image-convert';

const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;
const sizeOf=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;

export function imageConvertPage(){return `<div class="image-convert-page">
  <section class="image-convert-panel"><h2>批量转换与压缩</h2><p>本地处理 PNG、JPEG、WebP、GIF 和 TIFF。原图片保持不变，结果保存到所选文件夹。</p>
    <div class="image-convert-picks"><button id="image-convert-add" type="button">添加图片</button><button id="image-convert-clear" type="button" class="quiet">清空列表</button><span id="image-convert-count" aria-live="polite">尚未选择图片</span></div>
    <div id="image-convert-files" class="image-convert-files" aria-label="待转换图片"></div>
    <div class="image-convert-destination"><label for="image-convert-directory">输出文件夹</label><input id="image-convert-directory" readonly placeholder="选择保存位置"><button id="image-convert-pick-directory" type="button">选择文件夹</button></div>
    <div class="image-convert-options"><label>目标格式<select id="image-convert-format"><option value="original">保持原格式（压缩）</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp" selected>WebP</option><option value="gif">GIF</option><option value="tiff">TIFF</option><option value="ico">ICO 多尺寸图标</option><option value="svg">SVG 优化（仅 SVG 输入）</option></select></label>
      <label>JPEG / WebP 质量 <span id="image-convert-quality-value">85</span><input id="image-convert-quality" type="range" min="1" max="100" value="85"></label>
      <label>最大宽度<input id="image-convert-width" type="number" min="1" max="16384" step="1" placeholder="保持原尺寸"></label>
      <label>最大高度<input id="image-convert-height" type="number" min="1" max="16384" step="1" placeholder="保持原尺寸"></label>
      <label class="image-convert-metadata"><input id="image-convert-metadata" type="checkbox" checked>保留图片元数据</label><label class="image-convert-metadata"><input id="image-convert-motion-still" type="checkbox">动态照片仅导出静态图（不保留视频）</label></div>
    <p class="image-convert-note">选择“保持原格式”可批量压缩；质量仅作用于 JPEG / WebP，其他格式采用无损重新编码。ICO 会生成 16–256 像素的 7 种 PNG 图标，不保留元数据。SVG 可转为位图或优化原矢量结构，位图不能直接恢复为矢量。JPEG 会把透明区域填成白色。动图与多页图片请选择 GIF、WebP 或 TIFF；动画 PNG 暂不支持。单张最大 100 MB，SVG 最大 5 MB，每批最多 100 张。</p>
    <p id="image-codec-status" class="image-convert-note" role="status">正在检测 HEIC 编解码能力…</p>
    <div class="image-convert-actions"><button id="image-convert-start" type="button">开始转换</button><button id="image-convert-cancel" type="button" class="quiet" disabled>取消</button><button id="image-convert-retry" type="button" class="quiet" hidden>重试失败项</button><span id="image-convert-status" role="status" aria-live="polite"></span></div>
  </section></div>`;}

export function setupImageConvert(){
 const files=q<HTMLElement>('image-convert-files'),count=q<HTMLElement>('image-convert-count'),status=q<HTMLElement>('image-convert-status'),codecStatus=q<HTMLElement>('image-codec-status');
 const add=q<HTMLButtonElement>('image-convert-add'),clear=q<HTMLButtonElement>('image-convert-clear'),pickDirectory=q<HTMLButtonElement>('image-convert-pick-directory');
 const directory=q<HTMLInputElement>('image-convert-directory'),format=q<HTMLSelectElement>('image-convert-format'),quality=q<HTMLInputElement>('image-convert-quality');
 const width=q<HTMLInputElement>('image-convert-width'),height=q<HTMLInputElement>('image-convert-height'),metadata=q<HTMLInputElement>('image-convert-metadata'),motionStill=q<HTMLInputElement>('image-convert-motion-still');
 const start=q<HTMLButtonElement>('image-convert-start'),cancel=q<HTMLButtonElement>('image-convert-cancel'),retry=q<HTMLButtonElement>('image-convert-retry');
 let paths:string[]=[],results=new Map<string,ImageConvertResult>(),running=false,current:string|undefined;
 const render=()=>{
  count.textContent=paths.length?`已选择 ${paths.length} 张图片`:'尚未选择图片';
  files.innerHTML=paths.length?paths.map(path=>{const result=results.get(path),state=result?.status==='done'?'已完成':result?.status==='error'?'失败':result?.status==='cancelled'?'已取消':path===current?'转换中':'待处理';return `<div class="image-convert-file"><div><strong title="${esc(path)}">${esc(nameOf(path))}</strong><small>${result?.before?sizeOf(result.before):''}${result?.after?` → ${sizeOf(result.after)}`:''}</small>${result?.message?`<small title="${esc(result.message)}">${esc(result.message)}</small>`:''}</div><span class="image-convert-file-state" data-state="${result?.status||''}">${state}</span>${result?.output?`<button type="button" data-image-reveal="${esc(path)}">显示文件</button>`:''}</div>`;}).join(''):'<p class="image-convert-empty">添加图片后可开始批量转换。</p>';
  start.disabled=running||!paths.length;add.disabled=running;clear.disabled=running;pickDirectory.disabled=running;cancel.disabled=!running;
  for(const input of [directory,format])input.disabled=running;
  for(const input of [width,height,metadata])input.disabled=running||format.value==='ico'||format.value==='svg';motionStill.disabled=running;
  quality.disabled=running||!['original','jpeg','webp'].includes(format.value);
  retry.hidden=running||![...results.values()].some(result=>result.status!=='done');
  retry.disabled=running;
 };
 const options=():ImageConvertOptions=>{
  const dimension=(value:string,label:string)=>{if(!value.trim())return undefined;const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1||parsed>16384)throw Error(`${label}需在 1 至 16384 像素之间`);return parsed;};
  if(!directory.value)throw Error('请先选择输出文件夹');
  return {format:format.value as ImageConvertFormat,quality:Number(quality.value),maxWidth:dimension(width.value,'最大宽度'),maxHeight:dimension(height.value,'最大高度'),preserveMetadata:metadata.checked,motionPolicy:motionStill.checked?'still':'reject'};
 };
 const progress=(value:ImageConvertProgress)=>{if(!running)return;current=value.current;if(value.result){results.set(value.result.source,value.result);current=undefined;}status.textContent=`已完成 ${value.done} / ${value.total}`;render();};
 const run=async(selected:string[])=>{
  if(!selected.length)return;
  let settings:ImageConvertOptions;try{settings=options();}catch(error){toast(error);return;}
  running=true;current=undefined;for(const path of selected)results.delete(path);render();status.textContent=`正在处理 0 / ${selected.length}`;
  try{const summary=await api.imageConvertStart(selected,directory.value,settings);for(const result of summary.results)results.set(result.source,result);const done=summary.results.filter(result=>result.status==='done').length,failed=summary.results.filter(result=>result.status==='error').length;status.textContent=summary.cancelled?`已取消，完成 ${done} 张`:failed?`完成 ${done} 张，失败 ${failed} 张`:`已完成 ${done} 张`;
  }catch(error){status.textContent=errorMessage(error);toast(error);}finally{running=false;current=undefined;render();}
 };
 add.onclick=()=>void api.imageConvertPickFiles().then(chosen=>{const set=new Set(paths.map(path=>path.toLowerCase()));for(const path of chosen)if(!set.has(path.toLowerCase())&&paths.length<100){paths.push(path);set.add(path.toLowerCase());}render();if(chosen.length&&paths.length===100)status.textContent='每批最多 100 张图片';}).catch(toast);
 clear.onclick=()=>{paths=[];results.clear();current=undefined;status.textContent='';render();};
 pickDirectory.onclick=()=>void api.pickDirectory(directory.value||undefined).then(path=>{if(path)directory.value=path;}).catch(toast);
 quality.oninput=()=>{q('image-convert-quality-value').textContent=quality.value;};
 format.onchange=()=>{start.textContent=format.value==='original'?'开始压缩':format.value==='svg'?'开始优化':'开始转换';if(format.value==='ico'||format.value==='svg'){width.value='';height.value='';metadata.checked=false;}render();};
 start.onclick=()=>void run(paths);
 retry.onclick=()=>void run(paths.filter(path=>results.get(path)?.status!=='done'));
 cancel.onclick=()=>void api.imageConvertCancel().catch(toast);
 files.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-image-reveal]');const output=button&&results.get(button.dataset.imageReveal||'')?.output;if(output)void api.revealFile(output).catch(toast);};
 const unsubscribe=api.onImageConvertProgress(progress);render();
 void api.imageConvertCapabilities().then(capabilities=>{if(codecStatus.isConnected)codecStatus.textContent=capabilities.heicRead||capabilities.heicWrite?`HEIC 检测：读取${capabilities.heicRead?'可用':'不可用'}，写入${capabilities.heicWrite?'可用':'不可用'}；当前入口仅开放已验证格式。`:'当前内置引擎未提供 HEIC 编解码，HEIC 转换暂不可用。';}).catch(error=>{if(codecStatus.isConnected)codecStatus.textContent=`HEIC 能力检测失败：${errorMessage(error)}`;});
 return {dispose(){unsubscribe();if(running)void api.imageConvertCancel();}};
}
