import './image-ai.css';
import {api,q,toast,errorMessage} from './ui';
import type {ImageAiProgress,ImageAiResult} from '../shared/image-ai';

const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;
const megabytes=(bytes:number)=>`${(bytes/1048576).toFixed(1)} MB`;

export function imageSuperresPage(){return `<div class="image-ai-page">
 <div class="image-ai-layout"><section class="settings-card image-ai-setup" aria-label="超分设置"><h3>处理设置</h3>
 <div class="image-ai-field"><span class="image-ai-label">源图片</span><div class="image-ai-picker"><button id="image-superres-pick" type="button">选择图片</button><strong id="image-superres-source">尚未选择图片</strong></div></div>
 <div class="image-ai-field"><label class="image-ai-label" for="image-superres-directory">输出文件夹</label><div class="image-ai-directory"><input id="image-superres-directory" readonly placeholder="选择保存位置"><button id="image-superres-pick-directory" type="button">选择文件夹</button></div></div>
 <div class="image-ai-field"><span class="image-ai-label">本地模型</span><p id="image-superres-model" role="status">正在检查模型缓存…</p></div>
 <div class="image-ai-command"><button id="image-superres-start" type="button" disabled>开始超分</button><button id="image-superres-cancel" type="button" disabled>取消</button></div><span id="image-superres-status" class="image-ai-status" role="status" aria-live="polite"></span>
 <details class="tool-notes"><summary>模型与图片限制</summary><p class="image-ai-note">首次使用下载约 4.7 MB 模型，后续可离线运行。一次处理一张静态 PNG、JPEG、WebP 或 TIFF；输入不超过 30 MB、100 万像素，单边不超过 2048 像素。输出最多 1600 万像素，图片不会上传。</p></details></section>
 <section class="settings-card image-ai-preview" aria-label="超分预览"><h3>前后对比</h3><div class="image-ai-empty">选择图片后可在这里查看原图和 4× 结果。</div>
 <div id="image-superres-comparison" class="image-ai-comparison" hidden><figure><figcaption>原图</figcaption><img id="image-superres-original" alt="原始图片预览"></figure><figure><figcaption>4× 结果</figcaption><img id="image-superres-result" alt="超分 PNG 结果预览"></figure></div><div id="image-superres-output" class="image-ai-output" hidden><span id="image-superres-detail"></span><button id="image-superres-reveal" type="button">显示文件</button></div></section></div></div>`;}

export function setupImageSuperres(){
 const pick=q<HTMLButtonElement>('image-superres-pick'),sourceLabel=q<HTMLElement>('image-superres-source'),directory=q<HTMLInputElement>('image-superres-directory'),pickDirectory=q<HTMLButtonElement>('image-superres-pick-directory'),modelLabel=q<HTMLElement>('image-superres-model'),start=q<HTMLButtonElement>('image-superres-start'),cancel=q<HTMLButtonElement>('image-superres-cancel'),status=q<HTMLElement>('image-superres-status'),comparison=q<HTMLElement>('image-superres-comparison'),original=q<HTMLImageElement>('image-superres-original'),resultImage=q<HTMLImageElement>('image-superres-result'),output=q<HTMLElement>('image-superres-output'),detail=q<HTMLElement>('image-superres-detail'),reveal=q<HTMLButtonElement>('image-superres-reveal');
 let source='',result:ImageAiResult|undefined,running=false,ready=false,version=0;
 const render=()=>{sourceLabel.textContent=source?nameOf(source):'尚未选择图片';sourceLabel.title=source;pick.disabled=running;pickDirectory.disabled=running;start.disabled=running||!source||!directory.value;cancel.disabled=!running;start.textContent=ready?'开始 4× 超分':'下载模型并开始 4× 超分';output.hidden=!result;detail.textContent=result?`${result.width} × ${result.height} · ${megabytes(result.before)} → ${megabytes(result.after)} · ${result.message}`:'';};
 const preview=async(path:string,target:HTMLImageElement,ticket:number)=>{try{const value=await api.imageCropPreview(path);if(ticket===version){target.src=value.url;target.hidden=false;comparison.hidden=false;}}catch(error){if(ticket===version)status.textContent=`预览不可用：${errorMessage(error)}`;}};
 const progress=(value:ImageAiProgress)=>{if(!running)return;status.textContent=value.phase==='download'&&value.total&&value.received?`下载模型 ${Math.round(value.received/value.total*100)}%`:value.phase==='process'&&value.done&&value.total?`正在超分 ${value.done} / ${value.total} 块`:value.message;};
 pick.onclick=()=>void api.imagePickFiles().then(paths=>{if(!paths.length)return;source=paths[0];result=undefined;comparison.hidden=true;output.hidden=true;original.removeAttribute('src');resultImage.removeAttribute('src');const ticket=++version;void preview(source,original,ticket);status.textContent=paths.length>1?'仅选择第一张图片处理':'';render();}).catch(toast);
 pickDirectory.onclick=()=>void api.pickDirectory(directory.value||undefined).then(path=>{if(path)directory.value=path;render();}).catch(toast);
 start.onclick=()=>{if(!source||!directory.value)return;running=true;result=undefined;output.hidden=true;resultImage.removeAttribute('src');status.textContent=ready?'准备本地推理':'准备下载模型';render();const ticket=version;void api.imageSuperresStart(source,directory.value).then(value=>{result=value;ready=true;modelLabel.textContent='模型已缓存，可离线使用';status.textContent='4× 超分完成';void preview(value.output,resultImage,ticket);}).catch(error=>{status.textContent=errorMessage(error);}).finally(()=>{running=false;render();});};
 cancel.onclick=()=>void api.imageAiCancel().catch(toast);
 reveal.onclick=()=>{if(result)void api.revealFile(result.output).catch(toast);};
 const unsubscribe=api.onImageSuperresProgress(progress);void api.imageSuperresModelStatus().then(value=>{ready=value.ready;modelLabel.textContent=ready?'模型已缓存，可离线使用':`首次使用需下载 ${megabytes(value.bytes)} 模型（BSD-3-Clause）`;render();}).catch(error=>{modelLabel.textContent=`模型状态检查失败：${errorMessage(error)}`;render();});render();
 return {dispose(){unsubscribe();if(running)void api.imageAiCancel();}};
}
