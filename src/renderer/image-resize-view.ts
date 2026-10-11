import './image-resize.css';
import {api,esc,q,toast,errorMessage} from './ui';
import {imageResizeRule,type ImageResizeRule,type ImageConvertProgress,type ImageConvertResult} from '../shared/image-convert';

const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;
const sizeOf=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;

export function imageResizePage(){return `<div class="image-resize-page"><header class="image-resize-heading"><h2>批量缩放</h2><p>按像素、百分比或长边调整尺寸，结果保存为原格式的新文件。</p></header>
 <div class="image-resize-layout"><section class="settings-card image-resize-setup" aria-label="缩放设置"><h3>缩放设置</h3>
 <div class="image-resize-picks"><button id="image-resize-add" type="button">添加图片</button><button id="image-resize-clear" type="button">清空列表</button><span id="image-resize-count">尚未选择图片</span></div>
 <div class="image-resize-settings"><label>缩放规则<select id="image-resize-mode"><option value="pixels">按像素</option><option value="percent" selected>按比例</option><option value="long-edge">按长边</option></select></label>
  <div id="image-resize-pixels" class="image-resize-fields" hidden><label>宽度（像素）<input id="image-resize-width" type="number" min="1" max="16384" placeholder="可留空"></label><label>高度（像素）<input id="image-resize-height" type="number" min="1" max="16384" placeholder="可留空"></label></div>
  <div id="image-resize-percent" class="image-resize-fields"><label>比例（%）<input id="image-resize-percent-value" type="number" min="1" max="400" step="0.1" value="50"></label></div>
  <div id="image-resize-long-edge" class="image-resize-fields" hidden><label>最长边（像素）<input id="image-resize-long-edge-value" type="number" min="1" max="16384" value="1200"></label></div>
  <label class="image-resize-aspect"><input id="image-resize-keep-aspect" type="checkbox" checked>保持宽高比</label></div>
 <div class="image-resize-destination"><label for="image-resize-directory">输出文件夹</label><input id="image-resize-directory" readonly placeholder="选择保存位置"><button id="image-resize-pick-directory" type="button">选择文件夹</button></div>
 <p class="image-resize-note">按像素填写单边时自动计算另一边；同时填写宽高且保持比例时，会缩放到该范围内。取消保持比例可拉伸到指定宽高。比例可放大到 400%，单边最多 16384 像素、总输出最多 1 亿像素。输出会移除常规元数据。</p>
 <div class="image-resize-actions"><button id="image-resize-start" type="button" disabled>开始批量缩放</button><button id="image-resize-cancel" type="button" disabled>取消</button><button id="image-resize-retry" type="button" hidden>重试失败项</button><span id="image-resize-status" role="status" aria-live="polite"></span></div>
 </section><section class="settings-card image-resize-output" aria-label="缩放结果"><h3>处理结果</h3><div id="image-resize-results" class="image-resize-results" aria-label="缩放结果"></div></section></div></div>`;}

export function setupImageResize(){
 const add=q<HTMLButtonElement>('image-resize-add'),clear=q<HTMLButtonElement>('image-resize-clear'),count=q<HTMLElement>('image-resize-count'),mode=q<HTMLSelectElement>('image-resize-mode'),width=q<HTMLInputElement>('image-resize-width'),height=q<HTMLInputElement>('image-resize-height'),percent=q<HTMLInputElement>('image-resize-percent-value'),longEdge=q<HTMLInputElement>('image-resize-long-edge-value'),keepAspect=q<HTMLInputElement>('image-resize-keep-aspect');
 const pixelsFields=q<HTMLElement>('image-resize-pixels'),percentFields=q<HTMLElement>('image-resize-percent'),longEdgeFields=q<HTMLElement>('image-resize-long-edge'),directory=q<HTMLInputElement>('image-resize-directory'),pickDirectory=q<HTMLButtonElement>('image-resize-pick-directory'),start=q<HTMLButtonElement>('image-resize-start'),cancel=q<HTMLButtonElement>('image-resize-cancel'),retry=q<HTMLButtonElement>('image-resize-retry'),status=q<HTMLElement>('image-resize-status'),list=q<HTMLElement>('image-resize-results');
 let paths:string[]=[],running=false,current:string|undefined;const results=new Map<string,ImageConvertResult>();
 const render=()=>{count.textContent=paths.length?`已选择 ${paths.length} 张图片`:'尚未选择图片';
  list.innerHTML=paths.length?paths.map(path=>{const result=results.get(path),state=result?.status==='done'?'已完成':result?.status==='error'?'失败':result?.status==='cancelled'?'已取消':path===current?'缩放中':'待处理';return `<div class="image-resize-result-row"><strong title="${esc(path)}">${esc(nameOf(path))}</strong><span>${result?.before?sizeOf(result.before):''}${result?.after?` → ${sizeOf(result.after)}`:''}</span><span>${result?.width&&result?.height?`${result.width} × ${result.height}${result.pages&&result.pages>1?` · ${result.pages} 帧`:''}`:''}</span><em data-state="${result?.status||''}">${state}</em>${result?.message?`<small title="${esc(result.message)}">${esc(result.message)}</small>`:''}${result?.output?`<button type="button" data-resize-reveal="${esc(path)}">显示文件</button>`:''}</div>`;}).join(''):'<p>添加图片后可批量缩放。</p>';
  for(const field of [add,clear,mode,width,height,percent,longEdge,keepAspect,directory,pickDirectory])field.disabled=running||field===keepAspect&&mode.value!=='pixels';
  start.disabled=running||!paths.length||!directory.value;cancel.disabled=!running;retry.hidden=running||![...results.values()].some(result=>result.status!=='done');retry.disabled=running||!directory.value;};
 const updateMode=()=>{pixelsFields.hidden=mode.value!=='pixels';percentFields.hidden=mode.value!=='percent';longEdgeFields.hidden=mode.value!=='long-edge';if(mode.value!=='pixels')keepAspect.checked=true;render();};
 const rule=():ImageResizeRule=>{const optional=(field:HTMLInputElement)=>field.value.trim()?Number(field.value):undefined;
  if(mode.value==='pixels')return imageResizeRule({mode:'pixels',width:optional(width),height:optional(height),keepAspect:keepAspect.checked});
  if(mode.value==='percent')return imageResizeRule({mode:'percent',percent:Number(percent.value),keepAspect:true});
  return imageResizeRule({mode:'long-edge',longEdge:Number(longEdge.value),keepAspect:true});};
 const progress=(value:ImageConvertProgress)=>{if(!running)return;current=value.current;if(value.result){results.set(value.result.source,value.result);current=undefined;}status.textContent=`已完成 ${value.done} / ${value.total}`;render();};
 const run=async(selected:string[])=>{if(!selected.length)return;if(!directory.value){toast('请先选择输出文件夹');return;}let resize:ImageResizeRule;try{resize=rule();}catch(error){status.textContent=errorMessage(error);return;}running=true;current=undefined;for(const path of selected)results.delete(path);status.textContent=`正在缩放 0 / ${selected.length}`;render();
  try{const summary=await api.imageConvertStart(selected,directory.value,{format:'original',quality:95,preserveMetadata:false,resize});for(const result of summary.results)results.set(result.source,result);const done=summary.results.filter(result=>result.status==='done').length,failed=summary.results.filter(result=>result.status==='error').length;status.textContent=summary.cancelled?`已取消，完成 ${done} 张`:failed?`完成 ${done} 张，失败 ${failed} 张`:`已完成 ${done} 张`;
  }catch(error){status.textContent=errorMessage(error);toast(error);}finally{running=false;current=undefined;render();}
 };
 add.onclick=()=>void api.imagePickFiles().then(chosen=>{const set=new Set(paths.map(path=>path.toLowerCase()));for(const path of chosen)if(!set.has(path.toLowerCase())&&paths.length<100){paths.push(path);set.add(path.toLowerCase());}render();if(chosen.length&&paths.length===100)status.textContent='每批最多 100 张图片';}).catch(toast);
 clear.onclick=()=>{paths=[];results.clear();status.textContent='';render();};mode.onchange=updateMode;pickDirectory.onclick=()=>void api.pickDirectory(directory.value||undefined).then(path=>{if(path)directory.value=path;render();}).catch(toast);
 start.onclick=()=>void run(paths);retry.onclick=()=>void run(paths.filter(path=>results.get(path)?.status!=='done'));cancel.onclick=()=>void api.imageConvertCancel().catch(toast);
 list.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-resize-reveal]'),output=button&&results.get(button.dataset.resizeReveal||'')?.output;if(output)void api.revealFile(output).catch(toast);};
 const unsubscribe=api.onImageConvertProgress(progress);updateMode();return {dispose(){unsubscribe();if(running)void api.imageConvertCancel();}};
}
