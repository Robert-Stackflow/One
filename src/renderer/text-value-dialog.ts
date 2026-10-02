import {api,icon,toast} from './ui';
import {dialogMarkup,openDialog} from './dialog';
import {renderCode} from './code-view';
import './text-value-dialog.css';
export function textValueDialog(id:string,title:string,text:string,onClose=()=>{}){
 const template=document.createElement('template');template.innerHTML=dialogMarkup({id,title,className:'dialog-wide text-value-dialog',body:'<div class="text-value-code"></div>',actions:'<button data-copy-value>'+icon('copy')+'复制完整值</button>'});
 const dialog=template.content.firstElementChild as HTMLDialogElement,mount=dialog.querySelector<HTMLElement>('.text-value-code')!;let disposed=false,disposeCode=()=>{};
 const dispose=()=>{if(disposed)return;disposed=true;disposeCode();dialog.remove();onClose();};
 dialog.querySelector('[data-copy-value]')!.addEventListener('click',()=>void api.copyText(text).then(()=>{if(!disposed)toast('已复制');}).catch(toast));
 dialog.addEventListener('close',dispose,{once:true});document.body.append(dialog);openDialog(dialog);
 disposeCode=renderCode(mount,{name:'value.txt',path:'',type:'text',size:text.length,text,siblings:[]},true);return dispose;
}
