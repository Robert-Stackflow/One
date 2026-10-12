import {onRemoval} from './dom-lifecycle';
import {inheritCaptureScale} from './capture/appearance';
type Side='above'|'below';
interface Placement {preferred:Side;gap:number;edge?:number;width?:number;maxHeight?:number|(()=>number);boundary?:HTMLElement}

/** Keep an anchored popover and its arrow inside the viewport. */
export function positionAnchoredPopover(anchor:HTMLElement,popup:HTMLElement,{preferred,gap,edge=8,width:desiredWidth,maxHeight,boundary}:Placement):boolean {
 if(!anchor.isConnected||!popup.isConnected||!anchor.getClientRects().length||getComputedStyle(anchor).visibility==='hidden')return false;
 inheritCaptureScale(anchor,popup);
 const box=anchor.getBoundingClientRect();
 if(box.bottom<=0||box.top>=innerHeight||box.right<=0||box.left>=innerWidth)return false;
 const roomAbove=Math.max(0,box.top-gap-edge),roomBelow=Math.max(0,innerHeight-box.bottom-gap-edge);
 if(desiredWidth!==undefined){
  const limit=Math.max(0,Math.min(innerWidth-edge*2,boundary?boundary.clientWidth-edge*2:Infinity));
  popup.style.maxWidth=limit+'px';popup.style.width=Math.min(desiredWidth,limit)+'px';
 }
 const heightLimit=typeof maxHeight==='function'?maxHeight():maxHeight;
 if(heightLimit!==undefined)popup.style.maxHeight=Math.max(0,Math.min(heightLimit,Math.max(roomAbove,roomBelow)))+'px';
 const width=popup.offsetWidth,height=popup.offsetHeight;
 const side:Side=preferred==='above'
  ?roomAbove>=height||roomAbove>=roomBelow?'above':'below'
  :roomBelow>=height||roomBelow>=roomAbove?'below':'above';
 if(heightLimit!==undefined)popup.style.maxHeight=Math.max(0,Math.min(heightLimit,side==='above'?roomAbove:roomBelow))+'px';
 const finalHeight=popup.offsetHeight;
 const left=Math.max(edge,Math.min(box.right-width,innerWidth-width-edge));
 const top=Math.max(edge,Math.min(side==='above'?box.top-finalHeight-gap:box.bottom+gap,innerHeight-finalHeight-edge));
 popup.style.left=left+'px';popup.style.top=top+'px';popup.dataset.side=side;
 popup.style.transformOrigin=side==='above'?'bottom right':'top right';
 popup.style.setProperty('--arrow-left',Math.max(12,Math.min(width-18,box.left+box.width/2-left-4))+'px');
 return true;
}

export interface AnchoredPopoverOptions extends Partial<Placement> {mode?:'auto'|'manual';onDetach?:()=>void}
interface PopoverState {opened:boolean;revision:number;animation?:Animation;stop?:()=>void;release?:()=>void;closing?:Promise<boolean>}
const popovers=new WeakMap<HTMLElement,PopoverState>();

function animatePopover(popup:HTMLElement,state:PopoverState,opening:boolean,finish:()=>void):Promise<boolean>{
 const revision=++state.revision,style=getComputedStyle(popup),interrupted=!!state.animation;
 const from={opacity:interrupted?style.opacity:opening?'0':'1',translate:interrupted?style.translate:opening?`0 ${popup.dataset.side==='above'?6:-6}px`:'0 0',scale:interrupted?style.scale:opening?'.985':'1'};
 state.animation?.cancel();state.animation=undefined;
 if(!popup.isConnected||matchMedia('(prefers-reduced-motion:reduce)').matches){finish();return Promise.resolve(true);}
 const animation=popup.animate([from,{opacity:opening?'1':'0',translate:opening?'0 0':`0 ${popup.dataset.side==='above'?3:-3}px`,scale:opening?'1':'.985'}],{duration:opening?180:120,easing:opening?'cubic-bezier(.2,.8,.2,1)':'ease-in',fill:'both'});
 state.animation=animation;
 return animation.finished.then(()=>{if(state.revision!==revision)return false;animation.cancel();state.animation=undefined;finish();return true;},()=>false);
}

/** Open on the existing One placement/tracking core. Reopening revokes a pending close. */
export function openAnchoredPopover(anchor:HTMLElement,popup:HTMLElement,options:AnchoredPopoverOptions={}):boolean{
 if(!popup.isConnected||!anchor.isConnected){void closeAnchoredPopover(popup,{immediate:true});return false;}
 let state=popovers.get(popup);
 if(!state){state={opened:false,revision:0};popovers.set(popup,state);}
 state.stop?.();state.release?.();state.opened=true;state.closing=undefined;
 popup.classList.add('anchored-popover');popup.inert=false;popup.removeAttribute('aria-hidden');
 popup.popover=options.mode||'manual';
 if(!popup.matches(':popover-open'))popup.showPopover();
 const placement:Placement={preferred:'below',gap:6,width:340,maxHeight:470,...options};
 if(!positionAnchoredPopover(anchor,popup,placement)){void closeAnchoredPopover(popup,{immediate:true});return false;}
 const detach=()=>{void closeAnchoredPopover(popup,{immediate:true});options.onDetach?.();};
 const stop=trackAnchoredPopover(anchor,popup,placement,detach);
 const toggle=(event:Event)=>{if((event as ToggleEvent).newState==='closed'&&!popup.matches(':popover-open')&&state.opened)void closeAnchoredPopover(popup,{immediate:true});};
 popup.addEventListener('toggle',toggle);
 state.stop=()=>{stop();popup.removeEventListener('toggle',toggle);};
 state.release=onRemoval(popup,()=>{void closeAnchoredPopover(popup,{immediate:true});});
 void animatePopover(popup,state,true,()=>{});
 return true;
}

/** Resolve false if a reopen supersedes this close; removal only occurs for the winning close. */
export function closeAnchoredPopover(popup:HTMLElement,{immediate=false,remove=false}:{immediate?:boolean;remove?:boolean}={}):Promise<boolean>{
 const state=popovers.get(popup);
 if(!state){if(popup.matches(':popover-open'))popup.hidePopover();if(remove)popup.remove();return Promise.resolve(true);}
 if(!state.opened&&state.closing&&!immediate){const revision=state.revision;return state.closing.then(closed=>{if(closed&&remove&&state.revision===revision)popup.remove();return closed;});}
 state.opened=false;state.stop?.();state.stop=undefined;
 popup.inert=true;popup.setAttribute('aria-hidden','true');
 const finish=()=>{state.release?.();state.release=undefined;if(popup.matches(':popover-open'))popup.hidePopover();if(remove)popup.remove();};
 if(immediate||!popup.matches(':popover-open')){++state.revision;state.animation?.cancel();state.animation=undefined;finish();state.closing=Promise.resolve(true);}
 else state.closing=animatePopover(popup,state,false,finish);
 return state.closing;
}

/** Reposition on resize or scroll, and release observers when dismissed. */
export function trackAnchoredPopover(anchor:HTMLElement,popup:HTMLElement,placement:Placement,onDetach:()=>void):()=>void {
 let frame=0,stopped=false;
 const detach=()=>{if(stopped)return;stop();onDetach();};
 const update=()=>{frame=0;if(!stopped&&!positionAnchoredPopover(anchor,popup,placement))detach();};
 const schedule=()=>{if(!stopped&&!frame)frame=requestAnimationFrame(update);};
 const scaleChanged=(event:Event)=>{if(event.target instanceof Element&&event.target.contains(anchor))schedule();};
 const observer=new ResizeObserver(schedule);observer.observe(anchor);observer.observe(popup);if(placement.boundary)observer.observe(placement.boundary);
 window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);
 document.addEventListener('one:capture-scale',scaleChanged);
 const releaseAnchor=onRemoval(anchor,detach),releasePopup=onRemoval(popup,detach);
 const stop=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);observer.disconnect();releaseAnchor();releasePopup();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);document.removeEventListener('one:capture-scale',scaleChanged);};
 schedule();return stop;
}
