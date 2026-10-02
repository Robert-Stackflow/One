const selectable='[data-selectable],pre,code,td,dd,.textLayer,.slide-text,.font-alphabet';
const editable='textarea,input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]),[contenteditable=true],.cm-editor';

export function setupTextSelection(){
 let region:Element|null=null;
 document.addEventListener('pointerdown',event=>{const target=event.target as Element;region=target.closest('button,[role=button],[role=tab],[role=menuitem]')?null:target.closest(selectable);if(!region&&!target.closest(editable))window.getSelection()?.removeAllRanges();},true);
 document.addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey)||event.altKey||event.key.toLowerCase()!=='a')return;
  const target=event.target as Element;if(target.closest(editable))return;
  // Restrict Select All to the data the user is reading, never the app chrome.
  event.preventDefault();const selection=window.getSelection();
  if(target.closest('button,[role=button],[role=tab],[role=menuitem]'))return;
  const current=target.closest(selectable)||region;
  if(current?.isConnected&&current.getClientRects().length)selection?.selectAllChildren(current);
 },true);
}
