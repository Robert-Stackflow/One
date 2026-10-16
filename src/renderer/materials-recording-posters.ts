import {api} from './ui';

/** Repair missing posters lazily, with at most two decoders and no playing audio. */
export function recordingPosters(root:HTMLElement){
  const controller=new AbortController(),queue:HTMLImageElement[]=[];
  let running=0;
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){
      const img=entry.target.querySelector<HTMLImageElement>('img')!;observer.unobserve(entry.target);queue.push(img);
    }
    pump();
  },{root,rootMargin:'120px'});
  const missing=(img:HTMLImageElement)=>{if(controller.signal.aborted)return;img.hidden=true;img.onerror=null;observer.observe(img.parentElement!);};
  for(const img of root.querySelectorAll<HTMLImageElement>('.recording-preview img')){
    img.onerror=()=>missing(img);
    if(img.complete&&!img.naturalWidth)missing(img);
  }
  function pump(){
    while(!controller.signal.aborted&&running<2&&queue.length){
      const img=queue.shift()!;if(!img.isConnected)continue;
      running++;void generate(img).catch(error=>{if(!controller.signal.aborted)console.warn('Recording poster unavailable',idFor(img),error);}).finally(()=>{running--;pump();});
    }
  }
  const idFor=(img:HTMLImageElement)=>img.closest<HTMLElement>('[data-material-card]')?.dataset.materialCard;
  async function generate(img:HTMLImageElement){
    const id=img.closest<HTMLElement>('[data-material-card]')!.dataset.materialCard!;
    const video=document.createElement('video');video.muted=true;video.preload='auto';video.crossOrigin='anonymous';
    const abort=()=>{video.removeAttribute('src');video.load();};
    controller.signal.addEventListener('abort',abort,{once:true});
    try{
      const url=await api.materialsRecordingURL(id);
      if(controller.signal.aborted)return;
      await new Promise<void>((resolve,reject)=>{
        const finish=(error?:Error)=>{
          clearTimeout(timer);video.onloadeddata=null;video.onerror=null;
          controller.signal.removeEventListener('abort',cancel);
          error?reject(error):resolve();
        };
        const cancel=()=>finish(Error('cancelled'));
        const timer=setTimeout(()=>finish(Error('poster timeout')),10000);
        video.onloadeddata=()=>finish();video.onerror=()=>finish(Error('invalid media'));
        controller.signal.addEventListener('abort',cancel,{once:true});
        video.src=url;video.load();
      });
      if(controller.signal.aborted||!video.videoWidth||!video.videoHeight)return;
      const factor=Math.min(480/video.videoWidth,480/video.videoHeight,1),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(video.videoWidth*factor));canvas.height=Math.max(1,Math.round(video.videoHeight*factor));
      canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob||controller.signal.aborted)return;
      if(img.isConnected){img.src=canvas.toDataURL('image/png');img.hidden=false;}
      await api.materialsSaveRecordingThumbnail(id,new Uint8Array(await blob.arrayBuffer()));
    }finally{controller.signal.removeEventListener('abort',abort);abort();}
  }
  return ()=>{controller.abort();observer.disconnect();queue.length=0;};
}
