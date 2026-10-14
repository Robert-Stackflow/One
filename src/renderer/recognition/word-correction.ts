import type { OCRResult } from '../../shared/recognition/ocr';
import type { mountTextSelection } from './text-selection';
import { icon, registerIcons } from '../ui';
import { Pencil } from 'lucide';
import './word-correction.css';

type Word = NonNullable<ReturnType<ReturnType<typeof mountTextSelection>['wordSelection']>>;
export function mountWordCorrection(original:HTMLTextAreaElement,heading:HTMLElement,options:{
  word:()=>Word|undefined; busy:()=>boolean;
  apply:(word:Word,text:string)=>Promise<OCRResult>;
  applied:(result:OCRResult,word:Word)=>void;message:(value:unknown)=>void;
  stateChanged?():void;
}) {
  registerIcons({'ocr-correct-word':Pencil});
  const button=document.createElement('button');button.type='button';button.className='quiet icon-button text-word-correct';
  button.title=button.ariaLabel='校正选中词';button.innerHTML=icon('lucide:ocr-correct-word');button.disabled=true;
  heading.classList.add('text-word-heading');heading.append(button);
  const form=document.createElement('form');form.className='text-word-editor';form.hidden=true;
  const input=document.createElement('input');input.type='text';input.maxLength=2048;input.ariaLabel='校正文字';input.autocomplete='off';input.spellcheck=false;
  const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='保存';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='quiet';cancel.textContent='取消';
  form.append(input,save,cancel);original.before(form);
  let editing:Word|undefined,saving=false,disposed=false;
  const close=()=>{editing=undefined;form.hidden=true;button.ariaExpanded='false';};
  function sync(){
    const word=options.word();button.disabled=saving||options.busy()||!word||word.sourceText!==original.value;
    if(editing&&!saving&&(options.busy()||!word||word.selection.revision!==editing.selection.revision||word.wordId!==editing.wordId||word.lineId!==editing.lineId||original.value!==editing.sourceText))close();
  }
  button.onclick=()=>{
    if(saving)return;if(editing){close();return;}
    const word=options.word();if(!word||word.sourceText!==original.value||options.busy())return;
    editing=word;input.value=word.text;form.hidden=false;button.ariaExpanded='true';input.focus();input.select();
  };
  cancel.onclick=()=>{if(!saving)close();};
  input.onkeydown=event=>{if(event.key==='Escape'&&!saving){event.preventDefault();close();button.focus();}};
  form.onsubmit=event=>{
    event.preventDefault();if(!editing||saving||options.busy())return;
    const word=editing,text=input.value;if(text===word.text){close();return;}
    const current=options.word();
    if(original.value!==word.sourceText||!current||current.wordId!==word.wordId||current.lineId!==word.lineId||current.selection.revision!==word.selection.revision){close();return;}
    saving=true;input.disabled=save.disabled=cancel.disabled=button.disabled=true;
    options.stateChanged?.();
    void options.apply(word,text).then(result=>{if(!disposed){options.applied(result,word);close();}})
      .catch(error=>{if(!disposed)options.message(error);})
      .finally(()=>{if(!disposed){saving=false;input.disabled=save.disabled=cancel.disabled=false;options.stateChanged?.();sync();}});
  };
  return {sync,dispose(){disposed=true;form.remove();button.remove();},busy:()=>saving};
}
