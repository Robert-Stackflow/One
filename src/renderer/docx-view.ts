import {DocxDocument,DocxScrollViewer} from '@silurus/ooxml/docx';
import type {DocxHeading} from '../shared/docx-outline';
import type {SetOutline,SetOverview} from './preview-outline';
import './docx-view.css';

type Viewer=ReturnType<typeof DocxScrollViewer.fromDocument>;
interface Session {closed:boolean;controller:AbortController;worker?:Worker;rejectPreparation?:(error:Error)=>void;stopResolution?:()=>void;document?:DocxDocument;viewer?:Viewer}

export function renderDocx(host:HTMLElement,url:string,metadata:(value:Record<string,string>)=>void,outline:SetOutline=()=>{},overview:SetOverview=()=>{},openDefault:()=>void=()=>{}){
 const stage=document.createElement('div');stage.className='docx-preview';host.append(stage);
 let disposed=false,current:Session|undefined;
 const close=(session?:Session)=>{
  if(!session||session.closed)return;session.closed=true;session.controller.abort();session.rejectPreparation?.(new Error('已取消加载'));session.stopResolution?.();session.viewer?.destroy();session.document?.destroy();
 };
 const panel=(message:string,state:string)=>{
  stage.dataset.state=state;stage.replaceChildren();const content=document.createElement('div');content.className='docx-preview-status';content.setAttribute('role',state==='loading'?'status':'alert');
  const label=document.createElement('p');label.textContent=message;content.append(label);const actions=document.createElement('div');actions.className='docx-preview-actions';
  const button=(text:string,callback:()=>void)=>{const item=document.createElement('button');item.textContent=text;item.type='button';item.onclick=callback;actions.append(item);};
  if(state==='loading')button('取消加载',()=>{close(current);outline([]);overview([]);panel('已取消加载','cancelled');});else button('重试',start);
  button('用默认程序打开',openDefault);content.append(actions);stage.append(content);
 };
 const fail=(session:Session,error:unknown)=>{if(disposed||session.closed||current!==session)return;close(session);outline([]);overview([]);const message=error instanceof Error?error.message:'';panel(/limit|exceed|too large|过大|上限/i.test(message)?'文档内容超过预览上限，请用默认程序打开':'文档无法读取，请重试或用默认程序打开','error');};
 const prepare=(session:Session,bytes:ArrayBuffer)=>new Promise<{bytes:ArrayBuffer;headings:DocxHeading[]}>((resolve,reject)=>{
  const worker=new Worker(new URL('./docx-outline-worker.ts',import.meta.url),{type:'module'});session.worker=worker;
  let settled=false;const timer=setTimeout(()=>finish(new Error('文档目录读取超时')),15000);
  const finish=(error?:Error,value?:{bytes:ArrayBuffer;headings:DocxHeading[]})=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();session.worker=undefined;session.rejectPreparation=undefined;error?reject(error):resolve(value!);};
  session.rejectPreparation=error=>finish(error);worker.onerror=()=>finish(new Error('文档目录无法读取'));worker.onmessage=event=>event.data.error?finish(new Error(event.data.error)):finish(undefined,event.data);worker.postMessage(bytes,[bytes]);
 });
 function start(){
  if(disposed)return;close(current);const session:Session={closed:false,controller:new AbortController()};current=session;outline([]);overview([]);panel('正在加载文档…','loading');
  void(async()=>{
   const response=await fetch(url,{signal:session.controller.signal});if(!response.ok)throw new Error('文档读取失败');const bytes=await response.arrayBuffer();if(session.closed)return;
   const prepared=await prepare(session,bytes);if(session.closed)return;
   // Obtain the document after the first layout publication so cancellation can
   // destroy its worker while the remaining pages are still being paginated.
   const document=await DocxDocument.load(prepared.bytes,{mode:'worker',progressiveLayout:true,useGoogleFonts:false,cjkFallback:'sc',workerTimeoutMs:20000,resourceLimits:{maxArchiveEntries:20000,maxArchiveEntryBytes:32*1024*1024,maxTotalInflatedBytes:128*1024*1024}});
   if(session.closed||disposed){document.destroy();return;}session.document=document;await document.waitUntilLayoutComplete();if(session.closed)return;
   const surface=window.document.createElement('div');surface.className='docx-preview-surface';stage.replaceChildren(surface);
   // Supersample small text at low/fractional Windows scales. Keep the page's
   // CSS size unchanged, and rebuild only the viewer when display DPI changes.
   const mount=(page?:number,scale?:number)=>{
    session.viewer?.destroy();surface.replaceChildren();
    const dpr=Math.max(2,window.devicePixelRatio||1);
    session.viewer=DocxScrollViewer.fromDocument(surface,document,{dpr,paddingTop:24,paddingBottom:24,paddingLeft:24,paddingRight:24,gap:24,overscan:1,refitOnResize:true,background:'transparent',pageShadow:false,enableTextSelection:true,enableHyperlinks:false,onVisiblePageChange:index=>{if(!session.closed)host.dispatchEvent(new CustomEvent('preview-page',{detail:{page:index+1}}));},onError:error=>fail(session,error)});
    if(scale!==undefined)session.viewer.setScale(scale);if(page!==undefined)session.viewer.scrollToPage(page,{behavior:'auto'});
   };
   mount();
   const watchResolution=()=>{
    const media=window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const changed=()=>{if(session.closed)return;const page=session.viewer?.topVisiblePage||0,scale=session.viewer?.getScale();mount(page,scale);watchResolution();};
    media.addEventListener('change',changed,{once:true});session.stopResolution=()=>media.removeEventListener('change',changed);
   };
   watchResolution();
   const jump=(page:number)=>{if(!session.closed)session.viewer?.scrollToPage(page,{behavior:'auto'});};
   outline(prepared.headings.flatMap(heading=>{const page=document.getBookmarkPage(heading.bookmark);return page===undefined?[]:[{label:heading.label,depth:heading.depth,icon:'file',activate:()=>jump(page)}];}));
   overview(Array.from({length:document.pageCount},(_,page)=>({label:'第 '+(page+1)+' 页',activate:()=>jump(page),thumbnail:async()=>{
    if(session.closed)throw new DOMException('已取消加载','AbortError');
    const bitmap=await document.renderPageToBitmap(page,{width:180,dpr:1.5});
    try{
     if(session.closed)throw new DOMException('已取消加载','AbortError');
     const canvas=window.document.createElement('canvas');canvas.className='docx-page-thumbnail';canvas.setAttribute('aria-label','第 '+(page+1)+' 页');canvas.width=bitmap.width;canvas.height=bitmap.height;
     const context=canvas.getContext('2d');if(!context)throw new Error('无法生成页面缩略图');context.drawImage(bitmap,0,0);return canvas;
    }finally{bitmap.close();}
   }})));
   metadata({'页数':String(document.pageCount)});stage.dataset.state='ready';
  })().catch(error=>fail(session,error));
 }
 start();return()=>{disposed=true;close(current);stage.remove();};
}
