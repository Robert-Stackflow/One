type Side='above'|'below';
interface Placement {preferred:Side;gap:number;edge?:number}

/** Keep an anchored popover and its arrow inside the viewport. */
export function positionAnchoredPopover(anchor:HTMLElement,popup:HTMLElement,{preferred,gap,edge=8}:Placement):boolean {
 if(!anchor.isConnected||!popup.isConnected)return false;
 const box=anchor.getBoundingClientRect();
 if(box.bottom<=0||box.top>=innerHeight||box.right<=0||box.left>=innerWidth)return false;
 const width=popup.offsetWidth,height=popup.offsetHeight;
 const roomAbove=box.top-gap-edge,roomBelow=innerHeight-box.bottom-gap-edge;
 const side:Side=preferred==='above'
  ?roomAbove>=height||roomAbove>=roomBelow?'above':'below'
  :roomBelow>=height||roomBelow>=roomAbove?'below':'above';
 const left=Math.max(edge,Math.min(box.right-width,innerWidth-width-edge));
 const top=Math.max(edge,Math.min(side==='above'?box.top-height-gap:box.bottom+gap,innerHeight-height-edge));
 popup.style.left=left+'px';popup.style.top=top+'px';popup.dataset.side=side;
 popup.style.setProperty('--arrow-left',Math.max(12,Math.min(width-18,box.left+box.width/2-left-4))+'px');
 return true;
}

/** Reposition on resize or scroll, and release observers when dismissed. */
export function trackAnchoredPopover(anchor:HTMLElement,popup:HTMLElement,placement:Placement,onDetach:()=>void):()=>void {
 let frame=0,stopped=false;
 const update=()=>{frame=0;if(!stopped&&!positionAnchoredPopover(anchor,popup,placement))onDetach();};
 const schedule=()=>{if(!stopped&&!frame)frame=requestAnimationFrame(update);};
 const observer=new ResizeObserver(schedule);observer.observe(anchor);observer.observe(popup);
 window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);
 return()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);};
}
