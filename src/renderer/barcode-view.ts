import {api,q,esc,icon,errorMessage,toast} from './ui';
import {BarcodeReader} from './barcode-reader';
import {barcodeLimits,barcodeURL,type BarcodeImage,type BarcodeDecoded} from '../shared/barcode';
import './barcode.css';
import {installFileDropOverlay} from './file-drop-overlay';

const idleMessage='';
export function barcodePage(){return `
  <div class="barcode-source-actions" id="barcode-actions">
   <button id="barcode-file" class="primary">${icon('folder')}选择图片</button>
   <button id="barcode-clipboard">${icon('paste')}粘贴图片</button>
   <button id="barcode-screen" title="在鼠标所在屏幕框选条码">${icon('cut')}屏幕框选</button>
  </div>
 <div id="barcode-output" class="barcode-workspace">
  <section class="barcode-panel barcode-image-panel" aria-label="图片预览">
   <header class="barcode-panel-heading"><h2>图片</h2><span id="barcode-name" title="" hidden></span><span id="barcode-dimensions"></span><button id="barcode-clear" class="barcode-icon-button" title="清空图片与结果" aria-label="清空图片与结果" hidden>${icon('trash')}</button></header>
   <div class="barcode-canvas" id="barcode-canvas">
    <button id="barcode-empty" class="barcode-empty-drop"><span class="barcode-empty-icon">${icon('barcode')}</span><strong>拖入图片，识别条码</strong><span>点击选择图片，或按 Ctrl+V 粘贴</span><small>PNG、JPEG、WebP、GIF、BMP · 最大 32 MB</small></button>
    <div id="barcode-canvas-body" hidden><div id="barcode-image-stage"><img id="barcode-image" alt="待识别图片" draggable="false"><svg id="barcode-regions" xmlns="http://www.w3.org/2000/svg" aria-label="条码位置"></svg></div></div>
   </div>
   <footer class="barcode-preview-tools" id="barcode-preview-tools" hidden><span>图片预览</span><div><button id="barcode-zoom-out" class="barcode-icon-button" title="缩小图片" aria-label="缩小图片">${icon('minus')}</button><span id="barcode-zoom-value">100%</span><button id="barcode-zoom-in" class="barcode-icon-button" title="放大图片" aria-label="放大图片">${icon('plus')}</button><button id="barcode-fit" title="完整显示图片">${icon('fit')}适应</button></div></footer>
  </section>
  <section class="barcode-panel barcode-results-panel" aria-label="识别结果">
   <header class="barcode-panel-heading"><h2>识别结果</h2><span id="barcode-count" class="barcode-count" hidden></span><div class="barcode-result-feedback"><span id="barcode-status" role="status" aria-live="polite">${idleMessage}</span><button id="barcode-cancel" hidden>取消识别</button></div></header>
   <div id="barcode-results-empty" class="barcode-results-empty"><span class="barcode-empty-icon">${icon('list')}</span><strong id="barcode-empty-title">等待识别</strong><p id="barcode-empty-description">选择图片后，在这里查看和复制内容</p></div>
   <div id="barcode-result-body" hidden>
    <div id="barcode-results" aria-label="条码结果列表" hidden></div>
    <div id="barcode-result-detail" hidden>
     <div class="barcode-detail-heading"><span id="barcode-format"></span><span id="barcode-content-length"></span></div>
     <textarea id="barcode-content" readonly aria-label="识别内容" spellcheck="false"></textarea>
     <div class="barcode-result-actions"><button id="barcode-copy" class="primary">${icon('copy')}复制内容</button><button id="barcode-open" hidden>${icon('open')}打开链接</button></div>
    </div>
   </div>
  </section>
 </div>`;}

export function setupBarcode(){
 const reader=new BarcodeReader(),status=q('barcode-status'),workspace=q('barcode-output'),cancel=q<HTMLButtonElement>('barcode-cancel'),list=q('barcode-results'),detail=q('barcode-result-detail'),content=q<HTMLTextAreaElement>('barcode-content'),open=q<HTMLButtonElement>('barcode-open'),canvas=q('barcode-canvas'),stage=q('barcode-image-stage'),page=q('page-barcode');
 let active=false,busy=false,revision=0,selected=0,decoded:BarcodeDecoded|undefined,url='',zoom=1;
 const release=()=>{if(url)URL.revokeObjectURL(url);url='';};
 const setStatus=(message:string,state='')=>{status.textContent=message;status.dataset.state=state;};
 const showBusy=(value:boolean)=>{
  busy=value;workspace.setAttribute('aria-busy',String(value));
  if(value)clearDrag();
  for(const id of ['barcode-file','barcode-clipboard','barcode-screen','barcode-empty','barcode-clear'])q<HTMLButtonElement>(id).disabled=value;
  cancel.hidden=!value;
 };
 const fit=()=>{
  if(!decoded)return;
  const ratio=Math.min((canvas.clientWidth-40)/decoded.width,(canvas.clientHeight-40)/decoded.height,1);
  stage.style.width=Math.max(1,Math.round(decoded.width*ratio*zoom))+'px';
  q('barcode-zoom-value').textContent=Math.round(ratio*zoom*100)+'%';
  q<HTMLButtonElement>('barcode-zoom-out').disabled=zoom<=.25;
  q<HTMLButtonElement>('barcode-zoom-in').disabled=zoom>=8;
 };
 const resize=new ResizeObserver(fit);resize.observe(canvas);
 const resetZoom=()=>{zoom=1;fit();canvas.scrollTo(0,0);};
 q('barcode-zoom-out').onclick=()=>{zoom=Math.max(.25,zoom/1.5);fit();};
 q('barcode-zoom-in').onclick=()=>{zoom=Math.min(8,zoom*1.5);fit();};
 q('barcode-fit').onclick=resetZoom;
 const select=(index:number)=>{
  const result=decoded?.results[index];if(!result)return;
  selected=index;detail.hidden=false;
  q('barcode-format').textContent=`${result.format} · ${result.rotation}°${result.contentType==='Binary'?' · 十六进制':''}`;
  content.value=result.contentType==='Binary'?result.hex:result.text;
  q('barcode-content-length').textContent=content.value.length.toLocaleString()+' 字符';
  open.hidden=!barcodeURL(result.text);
  for(const row of list.querySelectorAll<HTMLButtonElement>('button'))row.setAttribute('aria-pressed',String(Number(row.dataset.barcodeResult)===index));
  for(const region of q('barcode-regions').querySelectorAll('[data-barcode-result]'))region.classList.toggle('selected',Number(region.getAttribute('data-barcode-result'))===index);
 };
 const showResult=(image:BarcodeImage,result:BarcodeDecoded,blob:Blob)=>{
  release();decoded=result;url=URL.createObjectURL(blob);q<HTMLImageElement>('barcode-image').src=url;
  q('barcode-name').textContent=image.name;q('barcode-name').title=image.name;
  q('barcode-dimensions').textContent=`${result.width} × ${result.height}`;
  for(const id of ['barcode-name','barcode-canvas-body','barcode-preview-tools','barcode-clear'])q(id).hidden=false;
  q('barcode-empty').hidden=true;resetZoom();
  q('barcode-regions').setAttribute('viewBox',`0 0 ${result.width} ${result.height}`);
  q('barcode-regions').innerHTML=result.results.map((r,i)=>`<polygon points="${r.position.map(p=>`${p.x},${p.y}`).join(' ')}" data-barcode-result="${i}" tabindex="0" role="button" aria-label="选择第 ${i+1} 个 ${esc(r.format)} 条码"/>`).join('');
  list.innerHTML=result.results.map((r,i)=>`<button type="button" data-barcode-result="${i}" aria-pressed="false"><span class="barcode-result-number">${i+1}</span><span class="barcode-result-summary"><strong>${esc(r.format)}</strong><span>${esc((r.text||r.hex).slice(0,100))}</span></span>${icon('chevron')}</button>`).join('');
  list.hidden=result.results.length<2;
  q('barcode-count').textContent=String(result.results.length);q('barcode-count').hidden=false;
  q('barcode-result-body').hidden=!result.results.length;detail.hidden=!result.results.length;
  q('barcode-results-empty').hidden=!!result.results.length;
  if(result.results.length)select(0);
  else{q('barcode-empty-title').textContent='没有识别到条码';q('barcode-empty-description').textContent='尝试更清晰的图片，或框选条码附近区域';}
  setStatus((result.results.length?`${result.elapsed} ms`:'未识别到支持的条码；可能格式不支持或图像不够清晰。')+(result.warnings.length?'；'+result.warnings.join('；'):''),result.results.length?'success':'empty');
 };
 const run=async(source:()=>Promise<BarcodeImage|null>)=>{
  if(!active||busy)return;
  const request=++revision;showBusy(true);setStatus('正在读取图片…','busy');
  try{
   const image=await source();if(request!==revision||!active)return;
   if(!image){setStatus('已取消');return;}
   const blob=new Blob([image.bytes as Uint8Array<ArrayBuffer>]);setStatus('正在识别…','busy');
   const result=await reader.read(image.bytes);if(request!==revision||!active)return;
   showResult(image,result,blob);
  }catch(error){if(request===revision&&active)setStatus(errorMessage(error),'error');}
  finally{if(request===revision)showBusy(false);}
 };
 q('barcode-file').onclick=()=>void run(async()=>{const path=await api.pickFile();return path?api.barcodeFile(path):null;});
 q('barcode-empty').onclick=()=>q('barcode-file').click();
 q('barcode-clipboard').onclick=()=>void run(()=>api.barcodeClipboard());
 q('barcode-screen').onclick=()=>void run(()=>api.barcodeCapture());
 const cancelWork=()=>{revision++;reader.cancel();void api.barcodeCancelCapture().catch(()=>{});showBusy(false);};
 cancel.onclick=()=>{cancelWork();setStatus('识别已取消');};
 q('barcode-clear').onclick=()=>{
  if(busy)return;
  release();decoded=undefined;list.innerHTML='';q('barcode-regions').innerHTML='';content.value='';q<HTMLImageElement>('barcode-image').removeAttribute('src');
  for(const id of ['barcode-name','barcode-canvas-body','barcode-preview-tools','barcode-clear','barcode-result-body','barcode-count'])q(id).hidden=true;
  q('barcode-dimensions').textContent='';q('barcode-name').textContent='';q('barcode-name').title='';detail.hidden=true;open.hidden=true;
  q('barcode-empty').hidden=false;q('barcode-results-empty').hidden=false;q('barcode-empty-title').textContent='等待识别';q('barcode-empty-description').textContent='选择图片后，在这里查看和复制内容';setStatus(idleMessage);
 };
 const choose=(event:Event)=>{const target=(event.target as Element).closest('[data-barcode-result]');if(target)select(Number(target.getAttribute('data-barcode-result')));};
 list.onclick=choose;q('barcode-regions').onclick=choose;
 q('barcode-regions').onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();choose(event);}};
 q('barcode-copy').onclick=()=>void api.copyText(content.value).then(()=>toast('已复制内容')).catch(toast);
 open.onclick=()=>{const value=decoded?.results[selected]?.text;if(value&&barcodeURL(value))void api.barcodeOpenLink(value).catch(toast);};
 const dropFile=(file:File)=>run(async()=>{if(file.size>barcodeLimits.bytes)throw Error('图片文件不能超过 32 MB');const path=api.droppedFile(file);return path?api.barcodeFile(path):{name:file.name||'粘贴图片',bytes:new Uint8Array(await file.arrayBuffer())};});
 const clearDrag=installFileDropOverlay(page,{placement:'host',spacious:true,title:'识别条码',detail:'松开图片以开始识别',enabled:()=>active&&!busy,acceptVirtualFiles:true,onDrop:(_paths,event)=>{const file=event.dataTransfer?.files[0];if(file)return dropFile(file);}});
 document.addEventListener('paste',event=>{
  if(!active||busy||(event.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]'))return;
  const image=[...(event.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));event.preventDefault();
  if(image)void dropFile(image);else void run(()=>api.barcodeClipboard());
 });
 window.addEventListener('beforeunload',()=>{reader.cancel();release();resize.disconnect();});
 return {activate(value:boolean){active=value;if(!value){cancelWork();clearDrag();if(status.dataset.state==='busy')setStatus('识别已取消');}else fit();},openPath(path:string){return run(()=>api.barcodeFile(path));}};
}
