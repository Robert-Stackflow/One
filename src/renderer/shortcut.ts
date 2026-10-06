import {api,icon,toast} from './ui';
/** Capture the actual combination while temporarily releasing our global shortcut. */
export function setupShortcut(input:HTMLInputElement,onError:(error:unknown)=>void=toast){
  input.readOnly=true;input.classList.add('shortcut-input');input.placeholder='点击录入快捷键';let original='',recording=false;
  const finish=()=>{if(!recording)return;recording=false;input.classList.remove('recording');input.placeholder='点击录入快捷键';void api.recordShortcut(false).catch(onError);};
  input.addEventListener('focus',()=>{original=input.value;recording=true;input.classList.add('recording');input.placeholder='按下组合键';void api.recordShortcut(true).catch(onError);});
  input.addEventListener('blur',finish);
  window.addEventListener('blur',finish);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();});
  input.addEventListener('pointerdown',()=>{if(document.activeElement===input&&!recording)input.dispatchEvent(new Event('focus'));});
  input.addEventListener('keydown',event=>{if(event.key==='Tab')return;event.preventDefault();event.stopPropagation();if(event.key==='Escape'){input.value=original;input.blur();return;}if(['Control','Shift','Alt','Meta'].includes(event.key))return;
    if((event.key==='Backspace'||event.key==='Delete')&&!event.ctrlKey&&!event.altKey&&!event.metaKey){input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));return;}
    const key=event.code.startsWith('Key')?event.code.slice(3):event.code.startsWith('Digit')?event.code.slice(5):event.key===' '?'Space':event.key;
    if(!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.test(key))return;
    input.value=[event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.metaKey?'Win':'',key].filter(Boolean).join('+');input.dispatchEvent(new Event('change',{bubbles:true}));
    // Restore hooks on key release, after the recorded chord has finished.
    input.addEventListener('keyup',()=>input.blur(),{once:true});
  });
  const wrapper=document.createElement('div');wrapper.className='shortcut-control';input.replaceWith(wrapper);wrapper.append(input);const clear=document.createElement('button');clear.className='icon-button quiet';clear.type='button';clear.title='清除快捷键';clear.setAttribute('aria-label','清除快捷键');clear.innerHTML=icon('close');clear.onclick=()=>{input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));};wrapper.append(clear);
}
