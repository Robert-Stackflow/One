import './image-ai.css';
import {api,q,toast,errorMessage} from './ui';
import type {ImageAiProgress,ImageAiResult} from '../shared/image-ai';

const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;
const megabytes=(bytes:number)=>`${(bytes/1048576).toFixed(1)} MB`;

export function imageAiPage(){return `<div class="image-ai-page"><header class="image-ai-heading"><h2>AI 去背景</h2><p>在本机生成透明 PNG 副本。图片不会上传；模型估计的边缘请在结果中检查。</p></header>
 <div class="image-ai-layout"><section class="settings-card image-ai-setup" aria-label="去背景设置"><h3>处理设置</h3>
 <div class="image-ai-field"><span class="image-ai-label">源图片</span><div class="image-ai-picker"><button id="image-ai-pick" type="button">选择图片</button><strong id="image-ai-source">尚未选择图片</strong></div></div>
 <div class="image-ai-field"><label class="image-ai-label" for="image-ai-directory">输出文件夹</label><div class="image-ai-directory"><input id="image-ai-directory" readonly placeholder="选择保存位置"><button id="image-ai-pick-directory" type="button">选择文件夹</button></div></div>
 <div class="image-ai-field"><span class="image-ai-label">本地模型</span><p id="image-ai-model" role="status">正在检查模型缓存…</p></div>
 <div class="image-ai-command"><button id="image-ai-start" type="button" disabled>开始去背景</button><button id="image-ai-cancel" type="button" disabled>取消</button></div><span id="image-ai-status" class="image-ai-status" role="status" aria-live="polite"></span>
 <p class="image-ai-note">首次使用下载约 4.4 MB 的 U²-Net-p 模型。每次处理一张 50 MB、2000 万像素以内的静态 PNG、JPEG、WebP 或 TIFF。</p></section>
 <section class="settings-card image-ai-preview" aria-label="去背景预览"><h3>前后对比</h3><div class="image-ai-empty">选择图片后可在这里查看原图和处理结果。</div>
 <div id="image-ai-comparison" class="image-ai-comparison" hidden><figure><figcaption>原图</figcaption><img id="image-ai-original" alt="原始图片预览"></figure><figure><figcaption>去背景结果</figcaption><img id="image-ai-result" alt="透明 PNG 结果预览"></figure></div><div id="image-ai-output" class="image-ai-output" hidden><span id="image-ai-detail"></span><button id="image-ai-reveal" type="button">显示文件</button></div></section></div></div>`;}

export function setupImageAi(){
 const pick=q<HTMLButtonElement>('image-ai-pick'),sourceLabel=q<HTMLElement>('image-ai-source'),directory=q<HTMLInputElement>('image-ai-directory'),pickDirectory=q<HTMLButtonElement>('image-ai-pick-directory'),modelLabel=q<HTMLElement>('image-ai-model'),start=q<HTMLButtonElement>('image-ai-start'),cancel=q<HTMLButtonElement>('image-ai-cancel'),status=q<HTMLElement>('image-ai-status'),comparison=q<HTMLElement>('image-ai-comparison'),original=q<HTMLImageElement>('image-ai-original'),resultImage=q<HTMLImageElement>('image-ai-result'),output=q<HTMLElement>('image-ai-output'),detail=q<HTMLElement>('image-ai-detail'),reveal=q<HTMLButtonElement>('image-ai-reveal');
 let source='',result:ImageAiResult|undefined,running=false,ready=false,version=0;
 const render=()=>{sourceLabel.textContent=source?nameOf(source):'尚未选择图片';sourceLabel.title=source;pick.disabled=running;pickDirectory.disabled=running;start.disabled=running||!source||!directory.value;cancel.disabled=!running;start.textContent=ready?'开始去背景':'下载约 4.4 MB 模型并去背景';output.hidden=!result;detail.textContent=result?`${result.width} × ${result.height} · ${megabytes(result.before)} → ${megabytes(result.after)} · ${result.message}`:'';};
 const loadPreview=async(path:string,target:HTMLImageElement,ticket:number)=>{try{const preview=await api.imageCropPreview(path);if(ticket===version){target.src=preview.url;target.hidden=false;comparison.hidden=false;}}catch(error){if(ticket===version)status.textContent=`预览不可用：${errorMessage(error)}`;}};
 const progress=(value:ImageAiProgress)=>{if(!running)return;status.textContent=value.phase==='download'&&value.total&&value.received?`下载模型 ${Math.round(value.received/value.total*100)}%`:value.message;};
 pick.onclick=()=>void api.imagePickFiles().then(paths=>{if(!paths.length)return;source=paths[0];result=undefined;output.hidden=true;comparison.hidden=true;original.removeAttribute('src');resultImage.removeAttribute('src');version++;const ticket=version;void loadPreview(source,original,ticket);status.textContent=paths.length>1?'仅选择第一张图片处理':'';render();}).catch(toast);
 pickDirectory.onclick=()=>void api.pickDirectory(directory.value||undefined).then(path=>{if(path)directory.value=path;render();}).catch(toast);
 start.onclick=()=>{if(!source||!directory.value)return;running=true;result=undefined;output.hidden=true;resultImage.removeAttribute('src');status.textContent=ready?'正在本地处理':'准备下载模型';render();const ticket=version;void api.imageAiStart(source,directory.value).then(value=>{result=value;ready=true;modelLabel.textContent='模型已缓存，可离线使用';status.textContent='去背景完成';void loadPreview(value.output,resultImage,ticket);}).catch(error=>{status.textContent=errorMessage(error);}).finally(()=>{running=false;render();});};
 cancel.onclick=()=>void api.imageAiCancel().catch(toast);
 reveal.onclick=()=>{if(result)void api.revealFile(result.output).catch(toast);};
 const unsubscribe=api.onImageAiProgress(progress);void api.imageAiModelStatus().then(value=>{ready=value.ready;modelLabel.textContent=ready?'模型已缓存，可离线使用':`首次使用需下载 ${megabytes(value.bytes)} 模型（Apache-2.0）`;render();}).catch(error=>{modelLabel.textContent=`模型状态检查失败：${errorMessage(error)}`;render();});render();
 return {dispose(){unsubscribe();if(running)void api.imageAiCancel();}};
}
