/** A shared sliding indicator and roving keyboard focus for segmented controls. */
export function setupSegments(){
 const root=document.querySelector<HTMLElement>('#app')!;
 const groups=new Map<HTMLElement,HTMLButtonElement[]>(),observers=new Map<HTMLElement,MutationObserver>(),dirty=new Set<HTMLElement>();
 let frame=0;
 const buttons=(group:HTMLElement)=>Array.from(group.children).filter((node):node is HTMLButtonElement=>node instanceof HTMLButtonElement);
 const eligible=(button:HTMLButtonElement)=>!button.disabled&&!button.hidden;
 const selected=(items:HTMLButtonElement[])=>items.find(b=>eligible(b)&&(b.classList.contains('selected')||b.getAttribute('aria-selected')==='true'||b.getAttribute('aria-pressed')==='true'))||items.find(eligible);
 const schedule=(group:HTMLElement)=>{dirty.add(group);if(!frame)frame=requestAnimationFrame(flush);};
 const resize=new ResizeObserver(entries=>{for(const {target}of entries){const group=target instanceof HTMLElement&&target.classList.contains('tabs')?target:target.parentElement;if(group instanceof HTMLElement&&groups.has(group))schedule(group);}});
 const register=(group:HTMLElement)=>{
  const previous=groups.get(group)||[],items=buttons(group);
  if(!groups.has(group)){
   resize.observe(group);
   const observer=new MutationObserver(records=>{
    if(records.some(({target,attributeName})=>target===group&&attributeName==='class'&&group.classList.contains('tabs'))){register(group);return;}
    if(records.some(({target})=>target===group||target instanceof HTMLButtonElement&&target.parentElement===group))schedule(group);
   });
   observer.observe(group,{subtree:true,attributes:true,attributeFilter:['class','aria-selected','aria-pressed','hidden','disabled']});
   observers.set(group,observer);
  }
  for(const button of previous)if(!items.includes(button))resize.unobserve(button);
  for(const button of items)if(!previous.includes(button))resize.observe(button);
  groups.set(group,items);schedule(group);
 };
 const discover=(node:Node)=>{if(!(node instanceof HTMLElement))return;if(node.matches('.tabs'))register(node);for(const group of node.querySelectorAll<HTMLElement>('.tabs'))register(group);};
 function flush(){
  frame=0;
  // Read every affected control before writing any styles, avoiding layout thrashing.
  const updates: {group:HTMLElement;items:HTMLButtonElement[];button:HTMLButtonElement|undefined;geometry:number[]|undefined}[]=[];
  for(const group of dirty){
   if(!group.isConnected){resize.unobserve(group);for(const button of groups.get(group)||[])resize.unobserve(button);observers.get(group)?.disconnect();observers.delete(group);groups.delete(group);continue;}
   if(!group.classList.contains('tabs')){group.classList.remove('segment-ready');continue;}
   const items=groups.get(group)||[],button=selected(items);
   updates.push({group,items,button,geometry:button&&group.offsetWidth?[button.offsetLeft,button.offsetTop,button.offsetWidth,button.offsetHeight]:undefined});
  }
  dirty.clear();
  for(const {group,items,button,geometry}of updates){
   for(const item of items)item.tabIndex=item===button?0:-1;
   if(!geometry){group.classList.remove('segment-ready');continue;}
   ['x','y','width','height'].forEach((name,index)=>{const property='--segment-'+name,value=geometry[index]+'px';if(group.style.getPropertyValue(property)!==value)group.style.setProperty(property,value);});
   if(!group.classList.contains('segment-ready'))group.classList.add('segment-ready');
  }
 }
 // Long result lists change classes frequently. Watch their child additions for
 // new controls, but leave selection attributes to each registered segment.
 new MutationObserver(records=>{
  for(const record of records){
   const node=record.target;if(!(node instanceof HTMLElement))continue;
   if(node.matches('.tabs'))register(node);
   for(const added of record.addedNodes)discover(added);
   if(record.removedNodes.length)for(const group of groups.keys())if(!group.isConnected)schedule(group);
  }
 }).observe(root,{subtree:true,childList:true});
 document.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!(event.target instanceof HTMLButtonElement)||event.altKey||event.ctrlKey||event.metaKey)return;
  const group=event.target.parentElement;if(!group?.matches('.tabs'))return;
  const items=buttons(group).filter(eligible),at=items.indexOf(event.target);if(at<0||!items.length)return;
  event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
  const button=items[index];button.focus({preventScroll:true});button.click();
  // Scroll only an overflowing segment, keeping the page's current position.
  const left=button.offsetLeft,right=left+button.offsetWidth;
  if(left<group.scrollLeft)group.scrollLeft=left;
  else if(right>group.scrollLeft+group.clientWidth)group.scrollLeft=right-group.clientWidth;
 });
 const refresh=()=>{for(const group of groups.keys())schedule(group);};
 document.fonts.addEventListener('loadingdone',refresh);void document.fonts.ready.then(refresh);
 discover(root);
}
