import {PptxViewer,type SlideHandle} from '@aiden0z/pptx-renderer';
import type {PptxHeading} from '../shared/pptx-outline';
import type {SetOutline,SetOverview} from './preview-outline';
import {api,toast} from './ui';
import './pptx-view.css';

interface Session {closed:boolean;controller:AbortController;worker?:Worker;rejectPreparation?:(error:Error)=>void;timer?:ReturnType<typeof setTimeout>;viewer?:PptxViewer;thumbnails:Map<HTMLElement,SlideHandle>}

export function renderPptx(host:HTMLElement,url:string,metadata:(value:Record<string,string>)=>void,outline:SetOutline=()=>{},overview:SetOverview=()=>{},openDefault:()=>void=()=>{}){
 const stage=document.createElement('div');stage.className='pptx-preview';host.append(stage);
 let disposed=false,current:Session|undefined;
 const close=(session?:Session)=>{if(!session||session.closed)return;session.closed=true;session.controller.abort();session.rejectPreparation?.(new Error('已取消加载'));clearTimeout(session.timer);for(const handle of session.thumbnails.values())handle.dispose();session.thumbnails.clear();session.viewer?.destroy();};
 const button=(label:string,callback:()=>void)=>{const element=document.createElement('button');element.type='button';element.textContent=label;element.onclick=callback;return element;};
 const panel=(message:string,state:string)=>{
  stage.dataset.state=state;const content=document.createElement('div');content.className='pptx-preview-status';content.setAttribute('role',state==='loading'?'status':'alert');const label=document.createElement('p');label.textContent=message;const actions=document.createElement('div');actions.className='pptx-preview-actions';
  actions.append(state==='loading'?button('取消加载',()=>{close(current);outline([]);overview([]);panel('已取消加载','cancelled');}):button('重试',start),button('用默认程序打开',openDefault));content.append(label,actions);stage.querySelector('.pptx-preview-status')?.remove();if(state!=='loading')stage.replaceChildren();stage.append(content);
 };
 const fail=(session:Session,error:unknown)=>{if(disposed||session.closed||current!==session)return;close(session);outline([]);overview([]);const message=error instanceof Error?error.message:'';panel(/limit|exceed|too large|过大|上限/i.test(message)?'演示文稿内容超过预览上限，请用默认程序打开':'演示文稿无法读取，请重试或用默认程序打开','error');};
 const prepare=(session:Session,bytes:ArrayBuffer)=>new Promise<{bytes:ArrayBuffer;headings:PptxHeading[]}>((resolve,reject)=>{
  const worker=new Worker(new URL('./pptx-outline-worker.ts',import.meta.url),{type:'module'});session.worker=worker;let settled=false;
  const timer=setTimeout(()=>finish(new Error('演示文稿目录读取超时')),15000);
  const finish=(error?:Error,value?:{bytes:ArrayBuffer;headings:PptxHeading[]})=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();session.worker=undefined;session.rejectPreparation=undefined;error?reject(error):resolve(value!);};
  session.rejectPreparation=error=>finish(error);worker.onerror=()=>finish(new Error('演示文稿目录无法读取'));worker.onmessage=event=>event.data.error?finish(new Error(event.data.error)):finish(undefined,event.data);worker.postMessage(bytes,[bytes]);
 });
 function start(){
  if(disposed)return;close(current);const session:Session={closed:false,controller:new AbortController(),thumbnails:new Map()};current=session;outline([]);overview([]);stage.replaceChildren();panel('正在加载演示文稿…','loading');
  void(async()=>{
   const response=await fetch(url,{signal:session.controller.signal});if(!response.ok)throw new Error('演示文稿读取失败');const bytes=await response.arrayBuffer();if(session.closed)return;const prepared=await prepare(session,bytes);if(session.closed)return;
   const toolbar=document.createElement('div');toolbar.className='pptx-preview-toolbar';toolbar.setAttribute('aria-label','幻灯片导航');const position=document.createElement('span');let page=0;
   const previous=button('上一张',()=>jump(page-1)),next=button('下一张',()=>jump(page+1));toolbar.append(previous,position,next);
   const notes=document.createElement('section');notes.className='pptx-preview-notes';notes.hidden=true;notes.setAttribute('aria-label','幻灯片备注');const notesHeader=document.createElement('div');notesHeader.className='pptx-preview-notes-header';const notesTitle=document.createElement('strong'),notesBody=document.createElement('div');notesBody.className='pptx-preview-notes-body';notesBody.setAttribute('data-selectable','');
   const copyNotes=button('复制备注',()=>void api.copyText(prepared.headings[page].notes).then(()=>toast('已复制备注')).catch(toast));
   const toggleNotes=button('备注',()=>{notes.hidden=!notes.hidden;toggleNotes.setAttribute('aria-expanded',String(!notes.hidden));});toggleNotes.setAttribute('aria-expanded','false');toolbar.append(toggleNotes);notesHeader.append(notesTitle,copyNotes,button('收起',()=>{notes.hidden=true;toggleNotes.setAttribute('aria-expanded','false');}));notes.append(notesHeader,notesBody);
   const notice=document.createElement('div');notice.className='pptx-preview-notice';notice.hidden=true;notice.append('部分内容无法显示',button('用默认程序打开',openDefault));
   const scroll=document.createElement('div');scroll.className='pptx-preview-scroll';const mount=document.createElement('div');mount.className='pptx-preview-mount';scroll.append(mount);stage.prepend(toolbar,notice,scroll,notes);
   const update=(index:number)=>{if(session.closed)return;page=index;position.textContent=`${index+1} / ${prepared.headings.length}`;previous.disabled=index===0;next.disabled=index>=prepared.headings.length-1;notesTitle.textContent=`第 ${index+1} 张备注`;
    const heading=prepared.headings[index];notesBody.replaceChildren();
    if(!heading.notes)notesBody.textContent='此页没有备注';
    else for(const paragraph of heading.notesRich){const line=document.createElement('p');for(const run of paragraph.runs){const span=document.createElement('span');span.textContent=run.text;if(run.bold)span.style.fontWeight='bold';if(run.italic)span.style.fontStyle='italic';if(run.underline)span.style.textDecoration='underline';if(run.color)span.style.color=run.color;if(run.sizePt)span.style.fontSize=`${run.sizePt}pt`;line.append(span);}notesBody.append(line);}
    copyNotes.disabled=!heading.notes;host.dispatchEvent(new CustomEvent('preview-page',{detail:{page:index+1}}));};update(0);
   const jump=(index:number)=>{if(!session.closed&&index>=0&&index<prepared.headings.length)void session.viewer?.goToSlide(index,{behavior:'instant'}).catch(error=>fail(session,error));};
   session.timer=setTimeout(()=>fail(session,new Error('演示文稿加载超时')),30000);
   // Offscreen slides also measure text synchronously. Paint the first page
   // before the viewport observer mounts adjacent pages on demand.
   const viewer=await PptxViewer.open(prepared.bytes,mount,{renderMode:'list',fitMode:'contain',scrollContainer:scroll,lazyMedia:true,lazySlides:true,pdfjs:false,signal:session.controller.signal,listOptions:{windowed:true,initialSlides:1,batchSize:16,overscanViewport:1,showSlideLabels:false},zipLimits:{maxEntries:20000,maxEntryUncompressedBytes:32*1024*1024,maxTotalUncompressedBytes:128*1024*1024,maxMediaBytes:96*1024*1024,maxConcurrency:4},onSlideChange:update,onSlideError:(_index,error)=>fail(session,error),onNodeError:()=>{notice.hidden=false;}});
   clearTimeout(session.timer);if(disposed||session.closed){viewer.destroy();return;}session.viewer=viewer;
   if(viewer.slideCount!==prepared.headings.length)throw new Error('演示文稿页面数量不一致');
   outline(prepared.headings.map((heading,index)=>({label:`${index+1}. ${heading.label}${heading.hidden?'（隐藏）':''}`,icon:'file',activate:()=>jump(index)})));
   overview(prepared.headings.map((heading,index)=>({label:`第 ${index+1} 张${heading.hidden?'（隐藏）':''}`,activate:()=>jump(index),thumbnail:()=>{
    if(session.closed)throw new DOMException('已取消加载','AbortError');const element=document.createElement('div');element.className='pptx-page-thumbnail';element.setAttribute('aria-label',heading.label);
    const handle=viewer.renderThumbnailToContainer(index,element,{width:180});if(!handle)throw new Error('无法生成页面缩略图');session.thumbnails.set(element,handle);
    // Chart initialization waits for a connected container. Return the surface
    // immediately so the overview can attach it before asynchronous rendering.
    void handle.ready.catch(()=>{handle.dispose();session.thumbnails.delete(element);if(!session.closed)element.textContent='缩略图无法显示';});return element;
   },disposeThumbnail:element=>{session.thumbnails.get(element)?.dispose();session.thumbnails.delete(element);}})));
   metadata({'页数':String(viewer.slideCount),'含备注页面':String(prepared.headings.filter(heading=>heading.notes).length)});stage.querySelector('.pptx-preview-status')?.remove();stage.dataset.state='ready';
  })().catch(error=>fail(session,error));
 }
 start();return()=>{disposed=true;close(current);stage.remove();};
}
