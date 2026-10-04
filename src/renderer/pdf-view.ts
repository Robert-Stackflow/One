import {getDocument,GlobalWorkerOptions,TextLayer,type PDFDocumentProxy,type PDFPageProxy,type RenderTask} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {iconButton,esc,toast} from './ui';
import type {SetOutline,SetOverview,OutlineItem} from './preview-outline';
import {VirtualRows} from './virtual-rows';
import {RowHeights} from '../shared/row-heights';
GlobalWorkerOptions.workerSrc=workerURL;
export async function renderPDF(host:HTMLElement,url:string,metadata:(values:Record<string,string>)=>void,outline:SetOutline=()=>{},overview:SetOverview=()=>{}){
 host.innerHTML=`<div class="reader-toolbar">${iconButton('pdf-prev','上一页','back')}<input id="pdf-page" aria-label="PDF 页码" inputmode="numeric" value="1"><span id="pdf-total"></span>${iconButton('pdf-next','下一页','arrow')}<span class="toolbar-divider"></span>${iconButton('pdf-minus','缩小','minus')}<span id="pdf-scale"></span>${iconButton('pdf-plus','放大','plus')}${iconButton('pdf-fit','适应宽度','fit')}${iconButton('pdf-rotate','旋转页面','rotate')}<div class="spacer"></div><input id="pdf-search" aria-label="搜索 PDF" placeholder="查找文本"><button id="pdf-find">查找</button><span id="pdf-found" role="status"></span></div><div class="pdf-scroll"><div class="pdf-pages"></div></div>`;
 const get=<T extends HTMLElement>(id:string)=>host.querySelector<T>('#'+id)!,scroll=host.querySelector<HTMLElement>('.pdf-scroll')!,pages=host.querySelector<HTMLElement>('.pdf-pages')!;
 let pdf:PDFDocumentProxy|undefined,current=1,jumpTarget=0,scale=1,fit=true,rotation=0,epoch=0,disposed=false,query='',matches:number[]=[],matchIndex=-1,searchRevision=0,searching=false,searchComplete=false,frame=0,active=0,resizeTimer:ReturnType<typeof setTimeout>;
 const sheets=new Map<number,HTMLElement>(),dimensions=new Map<number,{width:number;height:number}>(),rendered=new Map<number,number>(),tasks=new Set<RenderTask>(),pageTasks=new Map<number,RenderTask>(),layers=new Set<TextLayer>(),queued=new Set<number>(),running=new Set<number>(),populated=new Set<HTMLElement>();let virtual:VirtualRows|undefined,heights:RowHeights|undefined;
 const loading=getDocument({url,cMapUrl:new URL('pdf/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('pdf/standard_fonts/',location.href).href,wasmUrl:new URL('pdf/wasm/',location.href).href});
 const resources=new Map<number,PDFPageProxy>(),uses=new Map<number,number>(),canvasPool:HTMLCanvasElement[]=[],activeCanvases=new Set<HTMLCanvasElement>();
 function syncWidth(){const space=pages.querySelector<HTMLElement>('.virtual-row-space');if(!space)return;let width=0;for(const n of sheets.keys())width=Math.max(width,(dimensions.get(n)||dimensions.get(1)!).width*scale);space.style.width=Math.ceil(width)+'px';}
 function releasePage(n:number){
  if(uses.has(n)||rendered.has(n))return;
  if(resources.get(n)?.cleanup())resources.delete(n);
 }
 // Rendering, thumbnails and text extraction may share a page concurrently.
 // Release its decoded objects only after the last consumer and cached sheet finish.
 async function withPage<T>(n:number,consume:(page:PDFPageProxy)=>Promise<T>|T):Promise<T>{
  const document=pdf;
  if(!document||disposed)throw new DOMException('PDF preview closed','AbortError');
  uses.set(n,(uses.get(n)||0)+1);
  try{
   const page=await document.getPage(n);
   if(disposed)throw new DOMException('PDF preview closed','AbortError');
   resources.set(n,page);
   return await consume(page);
  }finally{
   const remaining=(uses.get(n)||1)-1;
   if(remaining)uses.set(n,remaining);else uses.delete(n);
   releasePage(n);
  }
 }
 function recycleCanvas(canvas:HTMLCanvasElement){
  if(activeCanvases.has(canvas))return;
  if(!disposed){if(canvasPool.includes(canvas))return;if(canvasPool.length<8){canvasPool.push(canvas);return;}}
  canvas.width=0;canvas.height=0;
 }
 function clearSheet(sheet:HTMLElement){
  for(const canvas of sheet.querySelectorAll('canvas'))recycleCanvas(canvas);
  sheet.replaceChildren();sheet.classList.remove('is-rendered');populated.delete(sheet);
 }
 function controls(){get<HTMLInputElement>('pdf-page').value=String(current);get('pdf-total').textContent='/ '+(pdf?.numPages||'');get('pdf-scale').textContent=Math.round(scale*100)+'%';get<HTMLButtonElement>('pdf-prev').disabled=current<=1;get<HTMLButtonElement>('pdf-next').disabled=current>=(pdf?.numPages||1);host.dispatchEvent(new CustomEvent('preview-page',{bubbles:true,detail:{page:current}}));}
 const visible=(n:number)=>{const box=sheets.get(n)?.getBoundingClientRect(),root=scroll.getBoundingClientRect();return !!box&&box.bottom>root.top-600&&box.top<root.bottom+600;};
 function evict(){if(rendered.size<=6)return;for(const [n]of [...rendered].sort((a,b)=>a[1]-b[1])){if(rendered.size<=6)break;if(!visible(n)){const sheet=sheets.get(n);if(sheet)clearSheet(sheet);rendered.delete(n);releasePage(n);}}}
 async function render(n:number,version:number){
  if(!pdf||disposed)return;
  await withPage(n,async p=>{
   if(version!==epoch||disposed)return;
   const viewport=p.getViewport({scale,rotation:(p.rotate+rotation)%360}),sheet=sheets.get(n);
   if(!sheet||!sheet.isConnected)return;
   const anchor=virtual?.location(),anchorPage=jumpTarget?jumpTarget-1:anchor?.position;if(heights?.set(n-1,viewport.height+28)&&anchor&&anchorPage!==undefined&&n-1<anchorPage)virtual?.anchor(anchorPage,jumpTarget?0:anchor.offset);
   dimensions.set(n,{width:viewport.width/scale,height:viewport.height/scale});
   sheet.style.width=viewport.width+'px';sheet.style.height=viewport.height+'px';
   syncWidth();
   sheet.style.setProperty('--scale-factor',String(scale));sheet.style.setProperty('--total-scale-factor',String(scale));
   const pixelScale=Math.min(devicePixelRatio,2,Math.sqrt(4_000_000/(viewport.width*viewport.height))),canvas=canvasPool.pop()||document.createElement('canvas'),text=document.createElement('div');
   text.className='textLayer';const width=Math.ceil(viewport.width*pixelScale),height=Math.ceil(viewport.height*pixelScale);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}else canvas.getContext('2d')!.reset();
   canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
   clearSheet(sheet);sheet.append(canvas,text);populated.add(sheet);
   const task=p.render({canvas,canvasContext:canvas.getContext('2d')!,viewport,transform:pixelScale!==1?[pixelScale,0,0,pixelScale,0,0]:undefined});
   tasks.add(task);activeCanvases.add(canvas);
   try{
    pageTasks.set(n,task);await task.promise;
    if(version!==epoch||disposed||!sheet.isConnected||sheets.get(n)!==sheet)return;
    const content=await p.getTextContent();
    if(version!==epoch||disposed||!sheet.isConnected||sheets.get(n)!==sheet)return;
    const layer=new TextLayer({textContentSource:content,container:text,viewport});layers.add(layer);
    try{await layer.render();}finally{layers.delete(layer);}
    if(version!==epoch||disposed||!sheet.isConnected||sheets.get(n)!==sheet)return;
    highlight(text);rendered.set(n,performance.now());sheet.classList.add('is-rendered');evict();
   }finally{tasks.delete(task);if(pageTasks.get(n)===task)pageTasks.delete(n);activeCanvases.delete(canvas);if(!canvas.isConnected)recycleCanvas(canvas);}
  });
 }
 function pump(){if(disposed)return;while(active<2&&queued.size){const n=[...queued].sort((a,b)=>Math.abs(a-current)-Math.abs(b-current))[0];queued.delete(n);if(rendered.has(n)||running.has(n)||!visible(n))continue;active++;running.add(n);const version=epoch;void render(n,version).catch(error=>{if(!disposed&&version===epoch&&error.name!=='RenderingCancelledException')toast(error);}).finally(()=>{active--;running.delete(n);if(version!==epoch&&!disposed&&visible(n))queued.add(n);pump();});}}
 function enqueue(n:number){if(n>0&&n<=(pdf?.numPages||0)&&!rendered.has(n)&&!running.has(n))queued.add(n);pump();}
 function highlight(text:HTMLElement){for(const span of text.querySelectorAll('span'))span.classList.toggle('pdf-hit',!!query&&!!span.textContent?.toLocaleLowerCase().includes(query));}
 function visiblePages(){for(let i=Math.max(1,current-4);i<=Math.min(pdf?.numPages||0,current+6);i++)if(visible(i))enqueue(i);}
 function pageAtScroll(){if(!heights||!virtual||!pdf)return;const location=virtual.location(),top=heights.offset(location.position)+location.offset;current=Math.min(pdf.numPages,heights.position(top+scroll.clientHeight*.5)+1);controls();visiblePages();evict();}
 function jump(n:number){if(!pdf||!virtual)return;current=Math.max(1,Math.min(pdf.numPages,n));jumpTarget=current;virtual.anchor(current-1);controls();visiblePages();}
 function layout(){
  if(!pdf||disposed)return;epoch++;for(const task of tasks)task.cancel();for(const layer of layers)layer.cancel();for(const sheet of [...populated])clearSheet(sheet);rendered.clear();queued.clear();virtual?.dispose();sheets.clear();pages.replaceChildren();
  const base=dimensions.get(1)!;if(fit)scale=Math.max(.15,Math.min(2,(scroll.clientWidth-56)/base.width));
  heights=new RowHeights(base.height*scale+28,pdf.numPages);for(const [n,d]of dimensions)heights.set(n-1,d.height*scale+28);
  pages.style.setProperty('--pdf-default-width',base.width*scale+'px');pages.style.setProperty('--pdf-default-height',base.height*scale+'px');
  const painted=()=>{
   const mounted=new Map<number,HTMLElement>();for(const row of virtual?.items.querySelectorAll<HTMLElement>('.pdf-page-row')||[])mounted.set(Number(row.dataset.page),row.querySelector<HTMLElement>('.pdf-sheet')!);
   for(const [n,sheet]of sheets)if(mounted.get(n)!==sheet){pageTasks.get(n)?.cancel();clearSheet(sheet);rendered.delete(n);releasePage(n);}
   sheets.clear();for(const [n,sheet]of mounted)sheets.set(n,sheet);
   syncWidth();
   for(const n of sheets.keys())if(visible(n))enqueue(n);
  };
  virtual=new VirtualRows(pages,()=>pdf!.numPages,(position,previous)=>{
   if(previous)return previous;const n=position+1,row=document.createElement('div'),sheet=document.createElement('div');row.className='pdf-page-row';row.dataset.page=String(n);sheet.className='pdf-sheet';sheet.dataset.page=String(n);sheet.setAttribute('aria-label','第 '+n+' 页');const d=dimensions.get(n);if(d){sheet.style.width=d.width*scale+'px';sheet.style.height=d.height*scale+'px';}row.append(sheet);return row;
  },base.height*scale+28,painted,heights);virtual.setViewport(scroll);
  for(const n of resources.keys())releasePage(n);jump(current);
 }
 get('pdf-prev').onclick=()=>jump(current-1);get('pdf-next').onclick=()=>jump(current+1);get('pdf-page').onchange=()=>jump(parseInt(get<HTMLInputElement>('pdf-page').value)||1);get('pdf-plus').onclick=()=>{fit=false;scale=Math.min(4,scale*1.2);layout();};get('pdf-minus').onclick=()=>{fit=false;scale=Math.max(.15,scale/1.2);layout();};get('pdf-fit').onclick=()=>{fit=true;layout();};get('pdf-rotate').onclick=()=>{rotation=(rotation+90)%360;for(const [n,d]of dimensions)dimensions.set(n,{width:d.height,height:d.width});layout();};
 const onScroll=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(pageAtScroll);},cancelJump=()=>{jumpTarget=0;};scroll.addEventListener('scroll',onScroll,{passive:true});scroll.addEventListener('wheel',cancelJump,{passive:true});scroll.addEventListener('pointerdown',cancelJump,{passive:true});scroll.addEventListener('keydown',cancelJump);
 const refreshHighlights=()=>{for(const text of pages.querySelectorAll<HTMLElement>('.textLayer'))highlight(text);};
 function resetSearch(status=''){
  searchRevision++;searching=false;searchComplete=false;query='';matches=[];matchIndex=-1;
  get('pdf-find').textContent='查找';get('pdf-found').textContent=status;refreshHighlights();
 }
 function showMatches(){
  get('pdf-found').textContent=matches.length?`${matchIndex+1}/${matches.length} 页`:'未找到';
  refreshHighlights();if(matches.length)jump(matches[matchIndex]);
 }
 async function find(){
  const document=pdf;if(!document||disposed)return;
  const next=get<HTMLInputElement>('pdf-search').value.trim().toLocaleLowerCase();
  if(!next){resetSearch();return;}
  if(next===query&&searchComplete){if(matches.length)matchIndex=(matchIndex+1)%matches.length;showMatches();return;}
  const version=++searchRevision,found:number[]=[];
  query=next;matches=[];matchIndex=-1;searching=true;searchComplete=false;
  get('pdf-find').textContent='停止';get('pdf-found').textContent=`查找 0/${document.numPages} 页`;refreshHighlights();
  try{
   for(let n=1;n<=document.numPages;n++){
    if(disposed||version!==searchRevision)return;
    const text=await withPage(n,p=>p.getTextContent());
    if(disposed||version!==searchRevision)return;
    if(text.items.map(item=>'str'in item?item.str:'').join(' ').toLocaleLowerCase().includes(next))found.push(n);
    if(n%8===0){get('pdf-found').textContent=`查找 ${n}/${document.numPages} 页`;await new Promise(r=>setTimeout(r,0));}
   }
   if(disposed||version!==searchRevision)return;
   matches=found;matchIndex=matches.length?0:-1;searchComplete=true;showMatches();
  }catch(error){
   if(!disposed&&version===searchRevision){get('pdf-found').textContent='查找失败';toast(error);}
  }finally{
   if(!disposed&&version===searchRevision){searching=false;get('pdf-find').textContent='查找';}
  }
 }
 get('pdf-find').onclick=()=>{if(searching)resetSearch('已停止');else void find();};
 get('pdf-search').onkeydown=e=>{if(e.key==='Enter')void find();};
 get('pdf-search').oninput=()=>{
  if(get<HTMLInputElement>('pdf-search').value.trim().toLocaleLowerCase()!==query)resetSearch();
 };
 const resize=new ResizeObserver(()=>{if(fit){clearTimeout(resizeTimer);resizeTimer=setTimeout(layout,120);}});resize.observe(scroll);
 async function thumbnail(n:number){const canvas=document.createElement('canvas');if(!pdf||disposed)return canvas;await withPage(n,async p=>{if(disposed)return;const base=p.getViewport({scale:1}),viewport=p.getViewport({scale:160/base.width});canvas.width=Math.ceil(viewport.width*devicePixelRatio);canvas.height=Math.ceil(viewport.height*devicePixelRatio);const task=p.render({canvas,canvasContext:canvas.getContext('2d')!,viewport,transform:devicePixelRatio!==1?[devicePixelRatio,0,0,devicePixelRatio,0,0]:undefined});tasks.add(task);try{await task.promise;}finally{tasks.delete(task);if(disposed){canvas.width=0;canvas.height=0;}}});return canvas;}
 async function directory(document:PDFDocumentProxy){const bookmarks=await document.getOutline();if(disposed)return;const entries:OutlineItem[]=[];if(bookmarks?.length){const add=(list:any[],depth:number)=>{for(const b of list){if(entries.length>=2000)return;if(b.dest)entries.push({label:b.title,depth,activate:()=>void(async()=>{if(disposed)return;const dest=typeof b.dest==='string'?await document.getDestination(b.dest):b.dest;if(dest)jump(typeof dest[0]==='number'?dest[0]+1:await document.getPageIndex(dest[0])+1);})().catch(toast)});if(b.items)add(b.items,depth+1);}};add(bookmarks,0);metadata({'目录来源':'PDF 书签'});outline(entries);return;}
  // Untagged PDFs often contain real headings without bookmarks. Infer only distinct larger text, never page numbers.
  const candidates:{label:string;size:number;n:number}[]=[],sizes=new Map<number,number>();for(let n=1;n<=Math.min(document.numPages,300);n++){if(disposed)return;const content=await withPage(n,p=>p.getTextContent());for(const item of content.items){if(!('str'in item)||!item.str.trim())continue;const font=Math.round(Math.hypot(item.transform[2],item.transform[3])*10)/10;sizes.set(font,(sizes.get(font)||0)+item.str.length);if(item.str.trim().length>=3&&item.str.length<=140)candidates.push({label:item.str.trim(),size:font,n});}if(n%8===0)await new Promise(r=>setTimeout(r,0));}
  if(disposed||!sizes.size)return;const body=[...sizes].sort((a,b)=>b[1]-a[1])[0][0],seen=new Set<string>(),levels=[...new Set(candidates.filter(c=>c.size>=body*1.2&&c.size>=body+2).map(c=>c.size))].sort((a,b)=>b-a);for(const c of candidates){if(c.size<body*1.2||c.size<body+2||seen.has(c.label)||/^\d+$/.test(c.label))continue;seen.add(c.label);entries.push({label:c.label,depth:levels.indexOf(c.size),activate:()=>jump(c.n)});if(entries.length>=1000)break;}if(entries.length)metadata({'目录来源':'文字字号识别','目录扫描范围':document.numPages>300?'前 300 页':'全部页面'});outline(entries);
 }
 void loading.promise.then(async pdfDoc=>{if(disposed)return;pdf=pdfDoc;const base=await withPage(1,first=>first.getViewport({scale:1}));if(disposed)return;dimensions.set(1,{width:base.width,height:base.height});const meta=await pdfDoc.getMetadata().catch(()=>null);if(disposed)return;metadata({'页数':String(pdf.numPages),...((meta?.info as any)?.Title?{'标题':String((meta!.info as any).Title)}:{})});layout();overview(Array.from({length:pdf.numPages},(_,i)=>({label:'第 '+(i+1)+' 页',activate:()=>jump(i+1),thumbnail:()=>thumbnail(i+1)})));void directory(pdfDoc).catch(()=>{});}).catch(error=>{if(!disposed)pages.innerHTML='<p class="render-error">'+esc(error.message||'PDF 无法读取')+'</p>';});
 return()=>{disposed=true;epoch++;searchRevision++;clearTimeout(resizeTimer);cancelAnimationFrame(frame);virtual?.dispose();resize.disconnect();scroll.removeEventListener('scroll',onScroll);scroll.removeEventListener('wheel',cancelJump);scroll.removeEventListener('pointerdown',cancelJump);scroll.removeEventListener('keydown',cancelJump);for(const task of tasks)task.cancel();for(const layer of layers)layer.cancel();rendered.clear();for(const sheet of [...populated])clearSheet(sheet);for(const canvas of canvasPool){canvas.width=0;canvas.height=0;}canvasPool.length=0;resources.clear();void loading.destroy();};
}
