import './screen-ruler.css';
import {api,q} from './ui';

export function renderScreenRuler(){
 document.documentElement.classList.add('transparent-root');document.body.className='screen-ruler-window';
 const mode=new URLSearchParams(location.search).get('mode')==='static'?'static':'live';
 q('app').innerHTML=`<main id="ruler-surface" data-mode="${mode}" aria-label="屏幕尺"><div class="ruler-hint">${mode==='live'?'实时画面':'静态画面'} · 拖拽框选区域 <span>Esc 退出 · 再次拖拽重新测量</span></div><div id="ruler-horizontal" class="ruler-guide"></div><div id="ruler-vertical" class="ruler-guide"></div><div id="ruler-selection" hidden></div><div id="ruler-readout" hidden></div></main>`;
 const surface=q<HTMLElement>('ruler-surface'),selection=q<HTMLElement>('ruler-selection'),readout=q<HTMLElement>('ruler-readout'),horizontal=q<HTMLElement>('ruler-horizontal'),vertical=q<HTMLElement>('ruler-vertical');
 const scale=Math.max(0.5,Math.min(4,Number(new URLSearchParams(location.search).get('scale'))||1));
 let start:{x:number;y:number}|undefined,dragging=false;
 const measure=(x:number,y:number)=>{if(!start)return;const left=Math.min(start.x,x),top=Math.min(start.y,y),width=Math.abs(x-start.x),height=Math.abs(y-start.y);selection.hidden=false;selection.style.left=left+'px';selection.style.top=top+'px';selection.style.width=width+'px';selection.style.height=height+'px';const w=Math.round(width*scale),h=Math.round(height*scale),distance=Math.round(Math.hypot(width,height)*scale);readout.hidden=false;readout.innerHTML=`<strong>${w} × ${h} px</strong><span>两点距离 ${distance} px</span>`;readout.style.left=Math.min(Math.max(12,left+width/2),window.innerWidth-155)+'px';readout.style.top=(top>64?top-46:Math.min(window.innerHeight-55,top+height+12))+'px';};
 surface.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};dragging=true;surface.setPointerCapture(event.pointerId);measure(event.clientX,event.clientY);});
 surface.addEventListener('pointermove',event=>{horizontal.style.top=event.clientY+'px';vertical.style.left=event.clientX+'px';if(dragging)measure(event.clientX,event.clientY);});
 surface.addEventListener('pointerup',event=>{if(!dragging)return;dragging=false;measure(event.clientX,event.clientY);surface.releasePointerCapture(event.pointerId);});
 surface.addEventListener('pointercancel',()=>{dragging=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();void api.closeScreenRuler();}});
}
