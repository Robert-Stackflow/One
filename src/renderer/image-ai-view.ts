import './image-ai.css';
import {api} from './ui';
import {setupImageAiBatch} from './image-ai-batch';

export function imageAiPage(){return `<div class="image-ai-page">
 <div class="image-ai-layout"><section class="settings-card image-ai-setup" aria-label="去背景设置"><h3>处理设置</h3>
 <div class="image-ai-field"><span class="image-ai-label">源图片</span><div class="image-ai-picker"><button id="image-ai-pick" type="button">选择图片</button><strong id="image-ai-source">尚未选择图片</strong></div></div>
 <div class="image-ai-field"><label class="image-ai-label" for="image-ai-directory">输出文件夹</label><div class="image-ai-directory"><input id="image-ai-directory" readonly placeholder="选择保存位置"><button id="image-ai-pick-directory" type="button">选择文件夹</button></div></div>
 <div class="image-ai-field"><span class="image-ai-label">本地模型</span><p id="image-ai-model" role="status">正在检查模型缓存…</p></div>
 <div class="image-ai-command"><button id="image-ai-start" class="primary" type="button" disabled>开始去背景</button><button id="image-ai-cancel" type="button" disabled>取消</button></div><span id="image-ai-status" class="image-ai-status" role="status" aria-live="polite"></span>
 <details class="tool-notes"><summary>模型与图片限制</summary><p class="image-ai-note">首次使用下载约 4.4 MB 的 U²-Net-p 模型。可一次选择最多 20 张静态 PNG、JPEG、WebP 或 TIFF；每张不超过 50 MB、2000 万像素。</p></details></section>
 <section class="settings-card image-ai-preview" aria-label="去背景预览"><h3>前后对比</h3><div class="image-ai-empty">选择图片后可在这里查看原图和处理结果。</div>
 <div id="image-ai-comparison" class="image-ai-comparison" hidden><figure><figcaption>原图</figcaption><img id="image-ai-original" alt="原始图片预览"></figure><figure><figcaption>去背景结果</figcaption><img id="image-ai-result" alt="透明 PNG 结果预览"></figure></div><div id="image-ai-output" class="image-ai-output" hidden><span id="image-ai-detail"></span><button id="image-ai-reveal" type="button">显示文件</button></div><div id="image-ai-batch-list" class="image-ai-batch-list" aria-label="批量结果" hidden></div></section></div></div>`;}

export function setupImageAi(){return setupImageAiBatch({prefix:'image-ai',action:'去背景',complete:'去背景完成',license:'Apache-2.0',modelStatus:()=>api.imageAiModelStatus(),start:(source,directory)=>api.imageAiStart(source,directory),onProgress:callback=>api.onImageAiProgress(callback),progress:value=>value.phase==='download'&&value.total&&value.received?`下载模型 ${Math.round(value.received/value.total*100)}%`:value.message});}
