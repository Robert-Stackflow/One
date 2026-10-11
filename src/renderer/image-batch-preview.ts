import './image-batch-preview.css';
import {api,esc,errorMessage} from './ui';
import type {ImageColorPreview} from '../shared/image-color';

interface BatchPreviewOptions {prefix:string;paths:()=>string[];validate:()=>void;card:(path:string,preview:ImageColorPreview)=>string}
const pageSize=8;
const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;

export function setupImageBatchPreview(options:BatchPreviewOptions){
 const q=<T extends HTMLElement=HTMLElement>(suffix:string)=>document.getElementById(`${options.prefix}-${suffix}`) as T;
 const load=q<HTMLButtonElement>('batch-load'),cancel=q<HTMLButtonElement>('batch-cancel'),previous=q<HTMLButtonElement>('batch-prev'),next=q<HTMLButtonElement>('batch-next'),position=q('batch-position'),status=q('batch-status'),grid=q('batch-grid');
 let page=0,revision=0,running=false,started=false;
 const cache=new Map<string,ImageColorPreview|Error>();
 const render=()=>{const paths=options.paths(),pages=Math.ceil(paths.length/pageSize);page=Math.min(page,Math.max(0,pages-1));const visible=paths.slice(page*pageSize,(page+1)*pageSize);
  position.textContent=pages?`${page+1} / ${pages}`:'';load.disabled=running||!paths.length;cancel.disabled=!running;previous.disabled=running||page===0;next.disabled=running||page>=pages-1;
  grid.innerHTML=started?visible.map(path=>{const item=cache.get(path);if(!item)return `<div class="image-batch-card"><strong>${esc(nameOf(path))}</strong><small>待载入</small></div>`;if(item instanceof Error)return `<div class="image-batch-card"><strong>${esc(nameOf(path))}</strong><small>${esc(item.message)}</small></div>`;try{return options.card(path,item);}catch(error){return `<div class="image-batch-card"><strong>${esc(nameOf(path))}</strong><small>${esc(errorMessage(error))}</small></div>`;}}).join(''):'';
 };
 const begin=async()=>{try{options.validate();}catch(error){status.textContent=errorMessage(error);return;}const id=++revision;running=true;started=true;status.textContent='正在读取预览…';render();const visible=options.paths().slice(page*pageSize,(page+1)*pageSize);
  for(const path of visible){if(id!==revision)return;if(cache.has(path))continue;try{const value=await api.imageColorPreview(path,true);if(id!==revision)return;cache.set(path,value);}catch(error){if(id!==revision)return;cache.set(path,Error(errorMessage(error)));}while(cache.size>24)cache.delete(cache.keys().next().value!);status.textContent=`已读取 ${visible.filter(item=>cache.has(item)).length} / ${visible.length}`;render();}
  running=false;status.textContent='';render();
 };
 load.onclick=()=>void begin();cancel.onclick=()=>{revision++;running=false;status.textContent='已取消';render();};
 previous.onclick=()=>{revision++;running=false;page--;void begin();};next.onclick=()=>{revision++;running=false;page++;void begin();};
 render();return {setPaths(){revision++;running=false;started=false;page=0;cache.clear();status.textContent='';render();},refresh(){render();},dispose(){revision++;}};
}
