/** Dock a workbench's results only when there is enough visible room.
 * In a short window the normal page remains the single scrolling surface. */
export function setupViewportPanel(viewport:HTMLElement,panel:HTMLElement,minimumHeight:()=>number=()=>180){
 let frame=0,lastHeight=0;
 const measure=()=>{
  frame=0;if(!panel.isConnected||!panel.getClientRects().length)return;
  const root=viewport.getBoundingClientRect(),box=panel.getBoundingClientRect();
  const top=box.top-root.top+viewport.scrollTop;
  const padding=parseFloat(getComputedStyle(viewport).paddingBottom)||0;
  const available=Math.floor(viewport.clientHeight-padding-top);
  const height=available>=minimumHeight()?available:0;
  if(height===lastHeight)return;lastHeight=height;
  panel.classList.toggle('viewport-docked',height>0);
  if(height)panel.style.setProperty('--viewport-panel-height',height+'px');
  else panel.style.removeProperty('--viewport-panel-height');
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
 const resize=new ResizeObserver(schedule);resize.observe(viewport);if(panel.parentElement)resize.observe(panel.parentElement);
 // Header, task progress and pane visibility can change the space above results.
 const changes=new MutationObserver(records=>{if(records.some(record=>record.target===panel||!panel.contains(record.target)))schedule();});changes.observe(panel.parentElement!,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
 document.fonts.addEventListener('loadingdone',schedule);void document.fonts.ready.then(schedule);schedule();
 return{refresh:schedule,destroy:()=>{cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();document.fonts.removeEventListener('loadingdone',schedule);}};
}
