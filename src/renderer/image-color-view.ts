import './image-color.css';
import {api,q,toast,errorMessage} from './ui';
import {ColorPalette} from './color-palette';
import type {ImageColorPreview} from '../shared/image-color';

export function imageColorPage(){return `<div class="image-color-page"><div class="image-color-heading"><h2>从图片取色</h2><p>打开或拖入图片，点击任意位置读取原图像素。透明像素按白色背景显示；动图与多页图片取第一页。</p></div>
 <div class="image-color-actions"><button id="image-color-open" type="button">打开图片</button><span id="image-color-name"></span><span id="image-color-status" role="status" aria-live="polite"></span></div>
 <div class="image-color-layout"><section class="image-color-image-panel"><div id="image-color-frame" class="image-color-frame"><div id="image-color-stage" class="image-color-stage"><img id="image-color-image" alt="待取色图片" draggable="false"><span id="image-color-marker" hidden></span></div><p id="image-color-empty">打开或拖入 PNG、JPEG、WebP、GIF、TIFF 图片。</p></div><p id="image-color-position"></p></section>
 <section id="image-color-palette" class="image-color-palette" aria-label="颜色面板与历史"><div class="image-color-sample" data-color-sample><span data-color-label></span></div><div class="image-color-edit"><input data-color-input aria-label="编辑颜色" value="#4479D8" maxlength="7" spellcheck="false"><button type="button" data-color-save>保存到历史并复制</button><button type="button" id="image-color-editor">颜色面板</button></div><div class="image-color-variants"><h3>相近色</h3><div data-color-variants></div></div><div class="image-color-values"><h3>颜色格式</h3><div data-color-values></div></div><section data-color-recent hidden><div class="image-color-history-heading"><h3>最近颜色</h3><button type="button" data-color-clear>清空</button></div><div data-color-history class="image-color-history"></div></section></section></div></div>`;}

export function setupImageColor(){
 const image=q<HTMLImageElement>('image-color-image'),frame=q<HTMLElement>('image-color-frame'),marker=q<HTMLElement>('image-color-marker'),empty=q<HTMLElement>('image-color-empty'),status=q<HTMLElement>('image-color-status'),name=q<HTMLElement>('image-color-name'),position=q<HTMLElement>('image-color-position');
 const palette=new ColorPalette(q('image-color-palette'));let source:string|undefined,preview:ImageColorPreview|undefined,revision=0,sampleRevision=0;
 const open=async(path:string)=>{const id=++revision;sampleRevision++;source=undefined;preview=undefined;image.removeAttribute('src');marker.hidden=true;empty.hidden=false;empty.textContent='正在读取图片…';status.textContent='';position.textContent='';try{const value=await api.imageColorPreview(path);if(id!==revision)return;image.src=value.url;await image.decode();if(id!==revision)return;source=path;preview=value;name.textContent=path.split(/[\\/]/).pop()||path;empty.hidden=true;status.textContent=value.pages>1?`已打开，取第 1 / ${value.pages} 帧`:`已打开 ${value.width} × ${value.height}`;}catch(error){if(id!==revision)return;empty.textContent=errorMessage(error);status.textContent=errorMessage(error);}};
 q<HTMLButtonElement>('image-color-open').onclick=()=>void api.imagePickFiles().then(paths=>{if(paths[0])void open(paths[0]);}).catch(toast);
 frame.ondragover=event=>{event.preventDefault();event.dataTransfer!.dropEffect='copy';};
 frame.ondrop=event=>{event.preventDefault();const file=event.dataTransfer?.files[0];if(file)try{const path=api.droppedFile(file);if(path)void open(path);}catch(error){toast(error);}};
 image.onclick=event=>{if(!source||!preview)return;const path=source,value=preview,id=++sampleRevision,box=image.getBoundingClientRect(),x=Math.min(value.width-1,Math.max(0,Math.floor((event.clientX-box.left)/box.width*value.width))),y=Math.min(value.height-1,Math.max(0,Math.floor((event.clientY-box.top)/box.height*value.height)));
  status.textContent='正在读取像素…';void api.imageColorSample(path,x,y).then(sample=>{if(id!==sampleRevision||source!==path)return;palette.select(sample.hex);marker.hidden=false;marker.style.left=`${(x+.5)/value.width*100}%`;marker.style.top=`${(y+.5)/value.height*100}%`;position.textContent=`像素 (${x}, ${y}) · ${sample.hex} · 不透明度 ${sample.alpha}%`;status.textContent='已取色，可复制格式或保存到历史';}).catch(error=>{if(id===sampleRevision)status.textContent=errorMessage(error);});
 };
 q<HTMLButtonElement>('image-color-editor').onclick=()=>void api.showColorEditor(palette.selected).catch(toast);
 return {dispose(){revision++;sampleRevision++;}};
}
