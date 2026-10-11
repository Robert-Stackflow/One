import './image-ai.css';
import {api} from './ui';
import {toolInfo} from './tool-page-components';
import {setupImageAiBatch} from './image-ai-batch';

export function imageAiPage(){return `<div class="image-ai-page">
 <div class="image-ai-layout"><section class="settings-card image-ai-setup" aria-label="去背景设置"><div class="tool-card-head"><h3>去背景</h3>${toolInfo("使用限制","首次使用下载约 4.4 MB 模型；最多 20 张静态图片，每张不超过 50 MB、2000 万像素。")}</div>
 <div class="image-ai-field"><span class="image-ai-label">源图片</span><div class="image-ai-picker"><button id="image-ai-pick" type="button">选择图片</button><strong id="image-ai-source">尚未选择图片</strong></div></div>
 <div class="image-ai-field"><label class="image-ai-label" for="image-ai-directory">输出文件夹</label><div class="image-ai-directory"><input id="image-ai-directory" readonly placeholder="选择保存位置"><button id="image-ai-pick-directory" type="button">选择文件夹</button></div></div>
 <div class="image-ai-field"><span class="image-ai-label">本地模型</span><p id="image-ai-model" role="status">正在检查模型缓存…</p></div>
 <div class="image-ai-command"><button id="image-ai-start" class="primary" type="button" disabled>开始去背景</button><button id="image-ai-cancel" type="button" disabled>取消</button></div><span id="image-ai-status" class="image-ai-status" role="status" aria-live="polite"></span>
 </section>
 <section class="settings-card image-ai-preview" aria-label="去背景预览"><h3>原图与结果</h3><div class="image-ai-empty">选择图片后显示预览</div>
 <div id="image-ai-comparison" class="image-ai-comparison" hidden><figure><figcaption>原图</figcaption><img id="image-ai-original" alt="原始图片预览"></figure><figure><figcaption>去背景结果</figcaption><img id="image-ai-result" alt="透明 PNG 结果预览"></figure></div><div id="image-ai-output" class="image-ai-output" hidden><span id="image-ai-detail"></span><button id="image-ai-reveal" type="button">显示文件</button></div><div id="image-ai-batch-list" class="image-ai-batch-list" aria-label="批量结果" hidden></div></section></div></div>`;}

export function setupImageAi(){return setupImageAiBatch({prefix:'image-ai',action:'去背景',complete:'去背景完成',license:'Apache-2.0',modelStatus:()=>api.imageAiModelStatus(),start:(source,directory)=>api.imageAiStart(source,directory),onProgress:callback=>api.onImageAiProgress(callback),progress:value=>value.phase==='download'&&value.total&&value.received?`下载模型 ${Math.round(value.received/value.total*100)}%`:value.message});}
