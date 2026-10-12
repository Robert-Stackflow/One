import {esc,icon} from './ui';

/** Shared filter-field anatomy, using One's existing field and focus styles. */
export function searchField(id:string,label:string,placeholder:string){
  return `<div class="filter-field" role="search">${icon('search')}<input id="${esc(id)}" type="search" aria-label="${esc(label)}" maxlength="512" placeholder="${esc(placeholder)}" autocomplete="off"><button type="button" class="icon-button quiet search-clear" title="清空" aria-label="清空" hidden>${icon('close')}</button></div>`;
}
export function setupSearchField(input:HTMLInputElement){
  const clear=input.parentElement!.querySelector<HTMLButtonElement>('.search-clear')!;
  const sync=()=>{clear.hidden=!input.value;};
  const reset=()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();};
  input.addEventListener('input',sync);clear.addEventListener('click',reset);sync();
  return ()=>{input.removeEventListener('input',sync);clear.removeEventListener('click',reset);};
}
