/** Retain One's component DOM when only its application data changes. */
const markup=new WeakMap<HTMLElement,string>();
const lists=new WeakMap<HTMLElement,Map<string,{node:HTMLElement;html:string}>>();
const parse=(html:string)=>{const source=document.createElement('template');source.innerHTML=html;return source.content;};
const same=(a:Node,b:Node)=>a.nodeType===b.nodeType&&(!(a instanceof Element)||b instanceof Element&&a.localName===b.localName&&a.namespaceURI===b.namespaceURI);
function patch(live:Node,previous:Node,next:Node,keep?:(node:Element)=>boolean){
 if(previous.isEqualNode(next))return;
 if(live instanceof Element&&previous instanceof Element&&next instanceof Element){
  if(keep?.(live))return;
  // Compare authored attributes, preserving runtime focus, expanded state and busy feedback.
  for(const attribute of previous.attributes)if(!next.hasAttribute(attribute.name))live.removeAttribute(attribute.name);
  for(const attribute of next.attributes)if(previous.getAttribute(attribute.name)!==attribute.value){
   if(attribute.name==='class'){const before=new Set((previous.getAttribute('class')||'').split(/\s+/).filter(Boolean)),after=new Set(attribute.value.split(/\s+/).filter(Boolean));for(const token of before)if(!after.has(token))live.classList.remove(token);for(const token of after)if(!before.has(token))live.classList.add(token);}
   else live.setAttribute(attribute.name,attribute.value);
  }
  if(live instanceof HTMLInputElement&&previous.hasAttribute('checked')!==next.hasAttribute('checked'))live.checked=next.hasAttribute('checked');
  const before=Array.from(previous.childNodes),after=Array.from(next.childNodes);
  for(let index=0;index<after.length;index++){
   const child=live.childNodes[index],old=before[index],value=after[index];
   if(child&&old&&same(old,value)&&same(child,value))patch(child,old,value,keep);
   else if(child)child.replaceWith(value.cloneNode(true));
   else live.append(value.cloneNode(true));
  }
  while(live.childNodes.length>after.length)live.lastChild!.remove();
 }else if(previous.nodeValue!==next.nodeValue)live.nodeValue=next.nodeValue;
}
function preserveFocus(root:HTMLElement,work:()=>void){
 const active=document.activeElement instanceof HTMLElement&&root.contains(document.activeElement)?document.activeElement:null;
 work();if(active?.isConnected&&document.activeElement!==active&&document.activeElement===document.body)active.focus({preventScroll:true});
}
export function clearMarkup(root:HTMLElement){markup.delete(root);lists.delete(root);}
/** Templates stay strings, so a large list does not retain a second detached DOM tree. */
export function keyedMarkup(root:HTMLElement,rows:readonly {key:string;html:string}[]){
 let cache=lists.get(root);if(!cache){cache=new Map();root.replaceChildren();lists.set(root,cache);markup.delete(root);}
 const keys=new Set(rows.map(row=>row.key));if(keys.size!==rows.length)throw new Error('Duplicate component identity');
 const entries=cache;preserveFocus(root,()=>{
  for(const [key,entry]of entries)if(!keys.has(key)){entry.node.remove();entries.delete(key);}
  let cursor=root.firstChild;
  for(const row of rows){
   let entry=entries.get(row.key);
   if(!entry){const node=parse(row.html).firstElementChild as HTMLElement;entry={node,html:row.html};entries.set(row.key,entry);}
   else if(entry.html!==row.html){const previous=parse(entry.html).firstElementChild!,next=parse(row.html).firstElementChild!;if(same(entry.node,next))patch(entry.node,previous,next);else{const node=next as HTMLElement;entry.node.replaceWith(node);if(cursor===entry.node)cursor=node;entry.node=node;}entry.html=row.html;}
   if(entry.node!==cursor)root.insertBefore(entry.node,cursor);
   cursor=entry.node.nextSibling;
  }
 });
}
/** Preserve live message descendants while a Markdown response streams. */
export function patchMarkup(root:HTMLElement,html:string,transform?:(source:HTMLElement)=>void,keep?:(node:Element)=>boolean){
 const before=markup.get(root);if(before===html)return;
 const source=root.cloneNode(false) as HTMLElement;source.innerHTML=html;transform?.(source);
 preserveFocus(root,()=>{if(before===undefined){root.replaceChildren(...source.childNodes);root.className=source.className;}else{const previous=root.cloneNode(false) as HTMLElement;previous.innerHTML=before;transform?.(previous);patch(root,previous,source,keep);}});
 markup.set(root,html);
}
