import {PreviewWorkerClient} from './preview-worker-client';
import {StructureTree,structurePath,type StructureNode,type StructureEntry,type StructureLocation} from '../shared/structured-preview';
import type {PreviewData} from '../shared/types';
import {VirtualRows} from './virtual-rows';
import {api,icon,iconButton,toast} from './ui';
import {textValueDialog} from './text-value-dialog';
import './structured-view.css';

export function renderStructured(host:HTMLElement,data:PreviewData,metadata:(values:Record<string,string>)=>void){
 const client=new PreviewWorkerClient(),root=document.createElement('div');root.className='data-tree structure-view';root.innerHTML='<div class="preview-loading">解析中…</div>';host.append(root);
 const pageSize=80,cache=new Map<string,StructureEntry[]>(),requests=new Map<string,Promise<StructureEntry[]>>();
 let disposed=false,tree:StructureTree,virtual:VirtualRows|undefined,scroll:HTMLElement,selected=0,keyboardVersion=0,keyboardQueue=Promise.resolve(),dialogDispose:(()=>void)|undefined;
 function resetKeyboard(){keyboardVersion++;keyboardQueue=Promise.resolve();}
 function page(parentId:number,index:number){
  const start=Math.floor(index/pageSize)*pageSize,key=parentId+':'+start,found=cache.get(key);
  if(found){cache.delete(key);cache.set(key,found);return Promise.resolve(found);}
  let request=requests.get(key);if(request)return request;
  request=client.request<StructureEntry[]>({structureAction:'children',id:parentId,start,count:pageSize}).then(entries=>{
   if(!disposed){cache.set(key,entries);while(cache.size>12)cache.delete(cache.keys().next().value!);virtual?.refresh();}return entries;
  }).finally(()=>requests.delete(key));requests.set(key,request);return request;
 }
 function available(position:number):{location:StructureLocation;entry:StructureEntry|undefined}{
  const location=tree.locate(position);
  if(location.branch)return{location,entry:{index:location.index,key:location.branch.key,node:location.branch.node}};
  const key=location.parent!.node.id+':'+Math.floor(location.index/pageSize)*pageSize,entries=cache.get(key);
  if(entries){cache.delete(key);cache.set(key,entries);return{location,entry:entries[location.index%pageSize]};}
  void page(location.parent!.node.id,location.index).catch(error=>{if(!disposed)toast(error);});return{location,entry:undefined};
 }
 async function resolveRow(position:number){const found=available(position);if(!found.entry){const entries=await page(found.location.parent!.node.id,found.location.index);found.entry=entries[found.location.index%pageSize];}return found;}
 function choose(position:number){selected=Math.max(0,Math.min(tree.root.size-1,position));scroll.setAttribute('aria-activedescendant','structure-row-'+selected);virtual?.reveal(selected);virtual?.refresh();}
 function update(){selected=Math.min(selected,tree.root.size-1);scroll.setAttribute('aria-activedescendant','structure-row-'+selected);root.querySelector('.structure-count')!.textContent=tree.root.size.toLocaleString()+' 行';virtual?.reveal(selected);virtual?.refresh();}
 function toggle(location:StructureLocation,entry:StructureEntry){
  if(location.branch?.open)tree.collapse(location.branch);else tree.expand(location,entry);update();
 }
 async function copy(location:StructureLocation,entry:StructureEntry){await api.copyText(structurePath(location,entry.key));if(!disposed)toast('已复制路径');}
 async function showValue(location:StructureLocation,entry:StructureEntry){
  const text=await client.request<string>({structureAction:'text',id:location.parent?.node.id??0,index:location.parent?location.index:undefined});if(disposed)return;
  dialogDispose?.();dialogDispose=textValueDialog('structure-value','完整值',text,()=>{dialogDispose=undefined;});
 }
 function row(position:number,previous?:HTMLElement){
  const {location,entry}=available(position),element=previous||document.createElement('div');element.className='structure-row data-row';element.id='structure-row-'+position;element.dataset.flatIndex=String(position);element.setAttribute('role','treeitem');element.setAttribute('aria-level',String((location.parent?.depth??-1)+2));element.setAttribute('aria-selected',String(position===selected));element.classList.toggle('is-current',position===selected);
  element.style.setProperty('--structure-depth',String(Math.min(14,(location.parent?.depth??-1)+1)));
  if(!entry){element.removeAttribute('aria-expanded');element.setAttribute('aria-busy','true');if(element.dataset.signature!=='pending'){element.replaceChildren();const label=document.createElement('span');label.className='structure-pending';label.textContent='读取中…';element.append(label);element.dataset.signature='pending';}return element;}
  element.removeAttribute('aria-busy');const node=entry.node,structured=node.kind==='array'||node.kind==='object',circular=tree.circular(location,node),expandable=structured&&node.count>0&&!circular,open=!!location.branch?.open;
  if(expandable)element.setAttribute('aria-expanded',String(open));else element.removeAttribute('aria-expanded');
  const signature=entry.key+'\0'+node.id+'\0'+node.kind+'\0'+node.preview+'\0'+Number(circular);
  if(element.dataset.signature!==signature){
   element.dataset.signature=signature;element.replaceChildren();
   if(structured){const button=document.createElement('button');button.className='tree-toggle';button.tabIndex=-1;button.disabled=!expandable;button.innerHTML=expandable?icon('chevron'):'<span class="tree-spacer"></span>';const label=document.createElement('strong');label.textContent=entry.key;label.title=entry.key;const count=document.createElement('span');count.textContent=circular?'循环引用':node.kind==='array'?'['+node.count.toLocaleString()+']':'{'+node.count.toLocaleString()+'}';button.append(label,count);element.append(button);}
   else{const spacer=document.createElement('span');spacer.className='tree-spacer';const key=document.createElement('span');key.className='data-key';key.textContent=entry.key;key.title=entry.key;key.dataset.selectable='';const value=document.createElement('span');value.className='data-value '+node.kind;value.dataset.selectable='';value.textContent=node.preview+(node.truncated?'…':'');element.append(spacer,key,value);if(node.truncated){const more=document.createElement('button');more.className='icon-button quiet data-expand-value';more.tabIndex=-1;more.title='查看完整值';more.setAttribute('aria-label','查看完整值');more.innerHTML=icon('ellipsis');element.append(more);}}
   const button=document.createElement('button');button.className='icon-button quiet data-copy';button.tabIndex=-1;button.title='复制路径';button.setAttribute('aria-label','复制路径');button.innerHTML=icon('copy');element.append(button);
  }
  const control=element.querySelector<HTMLButtonElement>('.tree-toggle');if(control){if(expandable)control.setAttribute('aria-expanded',String(open));else control.removeAttribute('aria-expanded');control.onclick=e=>{e.stopPropagation();resetKeyboard();choose(position);scroll.focus({preventScroll:true});toggle(location,entry);};}
  element.onclick=()=>{resetKeyboard();choose(position);if(!window.getSelection()?.toString())scroll.focus({preventScroll:true});};
  element.querySelector<HTMLButtonElement>('.data-copy')!.onclick=e=>{e.stopPropagation();void copy(location,entry).catch(toast);};
  const more=element.querySelector<HTMLButtonElement>('.data-expand-value');if(more)more.onclick=e=>{e.stopPropagation();void showValue(location,entry).catch(error=>{if(!disposed)toast(error);});};return element;
 }
 function keyboard(event:KeyboardEvent){
  const modified=event.ctrlKey||event.metaKey,key=modified&&event.key.toLowerCase()==='c'&&!window.getSelection()?.toString()?'copy':event.key;
  if(modified&&key!=='copy')return;
  const navigation=['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(key);
  if(!navigation&&!['ArrowRight','ArrowLeft','Enter','copy'].includes(key))return;
  event.preventDefault();event.stopPropagation();const version=keyboardVersion;
  keyboardQueue=keyboardQueue.then(async()=>{
   if(disposed||version!==keyboardVersion)return;
   if(navigation){const step=Math.max(1,Math.floor(scroll.clientHeight/36)-1);choose(key==='Home'?0:key==='End'?tree.root.size-1:selected+(key==='ArrowDown'?1:key==='ArrowUp'?-1:key==='PageDown'?step:-step));return;}
   const {location,entry}=await resolveRow(selected);if(disposed||version!==keyboardVersion||!entry)return;
   if(key==='copy')return copy(location,entry);
   if(key==='ArrowLeft'){if(location.branch?.open)toggle(location,entry);else if(location.parent)choose(tree.position(location.parent));}
   else if(key==='Enter'){if(entry.node.truncated)return showValue(location,entry);toggle(location,entry);}
   else if(location.branch?.open&&entry.node.count)choose(selected+1);else toggle(location,entry);
  }).catch(error=>{if(!disposed&&version===keyboardVersion)toast(error);});
 }
 void client.request<StructureNode>({text:data.text,url:data.textURL,type:data.type,structured:true}).then(node=>{
  if(disposed)return;tree=new StructureTree(node);root.innerHTML='<div class="structure-heading"><span class="structure-count"></span>'+iconButton('structure-collapse','收起全部','minus')+'</div><div class="structure-scroll" role="tree" tabindex="0" aria-label="结构化内容"></div>';scroll=root.querySelector<HTMLElement>('.structure-scroll')!;scroll.onkeydown=keyboard;
  virtual=new VirtualRows(scroll,()=>tree.root.size,row);root.querySelector<HTMLButtonElement>('#structure-collapse')!.onclick=()=>{resetKeyboard();tree.collapseAll();choose(0);update();scroll.focus({preventScroll:true});};update();metadata({'结构':node.kind==='array'?'数组':node.kind==='object'?'对象':'标量','顶层条目':String(node.count)});
 }).catch(error=>{if(!disposed){client.close();root.replaceChildren();const message=document.createElement('p');message.className='render-error';message.textContent=error.message;root.append(message);}});
 return()=>{disposed=true;resetKeyboard();client.close();virtual?.dispose();cache.clear();requests.clear();dialogDispose?.();root.remove();};
}
