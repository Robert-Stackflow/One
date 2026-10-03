import {esc,iconButton} from './ui';

interface DialogOptions {id:string;title:string;body:string;actions?:string;closeId?:string;titleId?:string;className?:string}
/** Body and actions are trusted UI markup; titles and attributes are escaped here. */
export function dialogMarkup(options:DialogOptions){
 const titleId=options.titleId||`${options.id}-title`,closeId=options.closeId||`${options.id}-close`;
 return `<dialog id="${esc(options.id)}" class="one-dialog ${esc(options.className||'')}" aria-labelledby="${esc(titleId)}" aria-modal="true"><header class="one-dialog-heading"><h2 id="${esc(titleId)}">${esc(options.title)}</h2>${iconButton(closeId,'关闭','close').replace('<button ','<button data-dialog-dismiss ')}</header><div class="one-dialog-body">${options.body}</div>${options.actions?`<footer class="one-dialog-actions">${options.actions}</footer>`:''}</dialog>`;
}
interface DialogState {focus?:HTMLElement;timer?:ReturnType<typeof setTimeout>;resolve?: (closed:boolean)=>void;pending?:Promise<boolean>;backdropDown:boolean}
const states=new WeakMap<HTMLDialogElement,DialogState>();
const motionProperties=['opacity','transform','backdrop','filter'];
function continueMotion(dialog:HTMLDialogElement,phase:'enter'|'exit'){
 const style=getComputedStyle(dialog),backdrop=getComputedStyle(dialog,'::backdrop'),values=[style.opacity,style.transform,backdrop.backgroundColor,backdrop.backdropFilter];
 motionProperties.forEach((property,index)=>dialog.style.setProperty(`--dialog-${phase}-${property}`,values[index]));
}
function focusField(dialog:HTMLDialogElement){
 const available=(element:HTMLElement)=>!element.matches(':disabled')&&!element.closest('[hidden],[inert]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility==='visible';
 if(Array.from(dialog.querySelectorAll<HTMLElement>('[autofocus]')).some(available))return;
 const active=document.activeElement;if(active!==dialog&&!(active instanceof Element&&active.closest('[data-dialog-dismiss]')))return;
 const field=Array.from(dialog.querySelectorAll<HTMLElement>('.one-dialog-body input:not([readonly]),.one-dialog-body textarea:not([readonly]),.one-dialog-body [contenteditable="true"]')).find(element=>(!(element instanceof HTMLInputElement)||!['hidden','checkbox','radio','range','color','file','button','submit','reset'].includes(element.type))&&available(element));
 field?.focus({preventScroll:true});
}
function stateFor(dialog:HTMLDialogElement){
 let state=states.get(dialog);if(state)return state;
 state={backdropDown:false};states.set(dialog,state);
 const outside=(e:MouseEvent)=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
 dialog.addEventListener('cancel',e=>{e.preventDefault();void closeDialog(dialog);});
 dialog.addEventListener('mousedown',e=>{state!.backdropDown=outside(e);});
 dialog.addEventListener('click',e=>{if(state!.pending){e.preventDefault();e.stopImmediatePropagation();return;}if((e.target as Element).closest('[data-dialog-dismiss]')||state!.backdropDown&&outside(e)){e.preventDefault();void closeDialog(dialog);}state!.backdropDown=false;},true);
 return state;
}
export function openDialog(dialog:HTMLDialogElement){
 const state=stateFor(dialog);
 if(state.pending){if(dialog.open)continueMotion(dialog,'enter');clearTimeout(state.timer);state.resolve?.(false);state.pending=undefined;state.resolve=undefined;state.timer=undefined;}
 dialog.classList.remove('closing');state.backdropDown=false;
 if(!dialog.open){for(const property of motionProperties)dialog.style.removeProperty('--dialog-enter-'+property);state.focus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;dialog.showModal();focusField(dialog);}
}
/** Returns false if a newer open request superseded this close. */
export function closeDialog(dialog:HTMLDialogElement):Promise<boolean>{
 const state=stateFor(dialog);if(state.pending)return state.pending;if(!dialog.open)return Promise.resolve(true);
 continueMotion(dialog,'exit');dialog.classList.add('closing');
 state.pending=new Promise(resolve=>{state.resolve=resolve;state.timer=setTimeout(()=>{
  state.timer=undefined;state.pending=undefined;state.resolve=undefined;
  if(dialog.open)dialog.close();dialog.classList.remove('closing');
  const focus=state.focus;state.focus=undefined;if(focus?.isConnected)focus.focus({preventScroll:true});resolve(true);
 },matchMedia('(prefers-reduced-motion:reduce)').matches?0:120);});
 return state.pending;
}
let confirmationId=0;
export function confirmDialog(options:{title:string;message:string;confirm?:string;danger?:boolean}):Promise<boolean>{
 return new Promise(resolve=>{
  const holder=document.createElement('template');holder.innerHTML=dialogMarkup({id:`confirmation-${++confirmationId}`,title:options.title,body:esc(options.message).replace(/\n/g,'<br>'),actions:`<button data-dialog-cancel autofocus>取消</button><button data-dialog-confirm class="primary ${options.danger?'danger':''}">${esc(options.confirm||'确定')}</button>`});
  const dialog=holder.content.firstElementChild as HTMLDialogElement;let answer=false,finished=false;
  dialog.addEventListener('close',()=>{if(finished)return;finished=true;dialog.remove();resolve(answer);});
  dialog.querySelector('[data-dialog-cancel]')!.addEventListener('click',()=>void closeDialog(dialog));
  dialog.querySelector('[data-dialog-confirm]')!.addEventListener('click',()=>{answer=true;void closeDialog(dialog);});
  document.body.append(dialog);openDialog(dialog);
 });
}
