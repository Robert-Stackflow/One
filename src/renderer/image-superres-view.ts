import './image-ai.css';
import {api} from './ui';
import {toolInfo} from './tool-page-components';
import {setupImageAiBatch} from './image-ai-batch';

export function imageSuperresPage(){return `<div class="image-ai-page">
 <div class="image-ai-layout"><section class="settings-card image-ai-setup" aria-label="超分设置"><h3>4× 超分</h3>
 <div class="image-ai-field"><span class="image-ai-label">源图片</span><div class="image-ai-picker"><button id="image-superres-pick" type="button">选择图片</button><strong id="image-superres-source">尚未选择图片</strong></div></div>
 <div class="image-ai-field"><label class="image-ai-label" for="image-superres-directory">输出文件夹</label><div class="image-ai-directory"><input id="image-superres-directory" readonly placeholder="选择保存位置"><button id="image-superres-pick-directory" type="button">选择文件夹</button></div></div>
 <div class="image-ai-field"><span class="image-ai-label">本地模型</span><p id="image-superres-model" role="status">正在检查模型缓存…</p></div>
 <div class="image-ai-command"><button id="image-superres-start" class="primary" type="button" disabled>开始超分</button><button id="image-superres-cancel" type="button" disabled>取消</button></div><span id="image-superres-status" class="image-ai-status" role="status" aria-live="polite"></span>
 ${toolInfo("使用限制","首次使用下载约 4.7 MB 模型；最多 20 张静态图片，每张不超过 30 MB、100 万像素，单边不超过 2048 像素。")}</section>
 <section class="settings-card image-ai-preview" aria-label="超分预览"><h3>原图与结果</h3><div class="image-ai-empty">选择图片后显示预览</div>
 <div id="image-superres-comparison" class="image-ai-comparison" hidden><figure><figcaption>原图</figcaption><img id="image-superres-original" alt="原始图片预览"></figure><figure><figcaption>4× 结果</figcaption><img id="image-superres-result" alt="超分 PNG 结果预览"></figure></div><div id="image-superres-output" class="image-ai-output" hidden><span id="image-superres-detail"></span><button id="image-superres-reveal" type="button">显示文件</button></div><div id="image-superres-batch-list" class="image-ai-batch-list" aria-label="批量结果" hidden></div></section></div></div>`;}

export function setupImageSuperres(){return setupImageAiBatch({prefix:'image-superres',action:'4× 超分',complete:'4× 超分完成',license:'BSD-3-Clause',modelStatus:()=>api.imageSuperresModelStatus(),start:(source,directory)=>api.imageSuperresStart(source,directory),onProgress:callback=>api.onImageSuperresProgress(callback),progress:value=>value.phase==='download'&&value.total&&value.received?`下载模型 ${Math.round(value.received/value.total*100)}%`:value.phase==='process'&&value.done&&value.total?`正在超分 ${value.done} / ${value.total} 块`:value.message});}
