import { imageTilePlan,OCR_PREVIEW_EDGE,type OCRImagePreviewRequest,type ImageTilePlan } from '../../shared/recognition/image-preview';
import type { TextView } from '../../shared/recognition/text-geometry';
interface Tile { plan:ImageTilePlan;node:HTMLDivElement;image:HTMLImageElement;url:string;used:number }
export function mountImageRaster(image:HTMLImageElement,inner:HTMLElement,size:{width:number;height:number},
  request:(region:OCRImagePreviewRequest)=>Promise<Uint8Array>,failed:(error:unknown)=>void){
  const layer=document.createElement('div');layer.className='text-image-tiles';layer.ariaHidden='true';image.after(layer);
  const cache=new Map<string,Tile>(),pending=new Set<string>(),failures=new Set<string>();
  let plans:ImageTilePlan[]=[],view:TextView|undefined,signature='',epoch=0,serial=0,active=0,disposed=false,baseURL='',reported=false;
  const baseFactor=Math.max(1,Math.ceil(Math.max(size.width,size.height)/OCR_PREVIEW_EDGE));
  function url(bytes:Uint8Array){const blob=new Blob([new Uint8Array(bytes)],{type:'image/png'});bytes.fill(0);return URL.createObjectURL(blob);}
  function paint(){
    if(!view||disposed)return;
    const wanted=new Set(plans.map(plan=>plan.key));
    for(const [key,tile] of cache){
      if(!wanted.has(key)){tile.node.remove();continue;}
      const {core,region}=tile.plan;tile.used=++serial;
      Object.assign(tile.node.style,{left:core.left*view.scale+'px',top:core.top*view.scale+'px',width:core.width*view.scale+'px',height:core.height*view.scale+'px'});
      Object.assign(tile.image.style,{left:(region.left-core.left)*view.scale+'px',top:(region.top-core.top)*view.scale+'px',width:region.width*view.scale+'px',height:region.height*view.scale+'px'});
      if(!tile.node.isConnected)layer.append(tile.node);
    }
    const ready=plans.some(plan=>plan.required)&&plans.filter(plan=>plan.required).every(plan=>cache.has(plan.key));
    inner.classList.toggle('image-detail-ready',ready);layer.hidden=!ready;
    for(const [key,tile] of [...cache].sort((a,b)=>a[1].used-b[1].used)){
      if(cache.size<=64)break;if(wanted.has(key))continue;tile.node.remove();URL.revokeObjectURL(tile.url);cache.delete(key);
    }
  }
  function pump(){
    if(disposed||document.hidden)return;
    for(const plan of plans){
      if(active>=4)break;if(cache.has(plan.key)||pending.has(plan.key)||failures.has(plan.key))continue;
      const generation=epoch;pending.add(plan.key);active++;
      void request({view:generation,...plan.region}).then(async bytes=>{
        if(disposed){bytes.fill(0);return;}
        const source=url(bytes),node=document.createElement('div'),tileImage=document.createElement('img');node.className='text-image-tile';
        tileImage.alt='';tileImage.draggable=false;tileImage.src=source;node.append(tileImage);
        try{await tileImage.decode();}catch(error){URL.revokeObjectURL(source);throw error;}
        if(disposed||cache.has(plan.key)){URL.revokeObjectURL(source);return;}
        cache.set(plan.key,{plan,node,image:tileImage,url:source,used:++serial});
      }).catch(error=>{if(!disposed&&generation===epoch){failures.add(plan.key);if(!reported){reported=true;failed(error);}}})
        .finally(()=>{pending.delete(plan.key);active--;paint();pump();});
    }
  }
  const visibility=()=>pump();document.addEventListener('visibilitychange',visibility);
  return {
    async base(){
      const bytes=await request({view:0,left:0,top:0,...size,downsample:baseFactor});
      if(disposed){bytes.fill(0);throw Error('图片预览已关闭');}
      baseURL=url(bytes);image.dataset.virtualized='true';return baseURL;
    },
    update(next:TextView,bounds:{left:number;top:number;right:number;bottom:number}){
      if(disposed||!baseURL)return;view=next;
      const density=window.devicePixelRatio||1;
      const nextPlans=next.scale*density*baseFactor<=1?[]:imageTilePlan(size,bounds,next.scale,density);
      const key=nextPlans.map(plan=>plan.key+(plan.required?'!':'')).join('|');
      plans=nextPlans;if(key!==signature){signature=key;epoch++;reported=false;failures.clear();}
      paint();pump();
    },
    dispose(){disposed=true;document.removeEventListener('visibilitychange',visibility);for(const tile of cache.values())URL.revokeObjectURL(tile.url);cache.clear();if(baseURL)URL.revokeObjectURL(baseURL);inner.classList.remove('image-detail-ready');layer.remove();delete image.dataset.virtualized;},
  };
}
