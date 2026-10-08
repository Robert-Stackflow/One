import {api,icon,toast} from './ui';

type Key={key:string;code?:string;ctrlKey:boolean;altKey:boolean;shiftKey:boolean;metaKey:boolean};
function keyName(key:Key){const code=key.code||'';return code.startsWith('Key')?code.slice(3):code.startsWith('Digit')?code.slice(5):key.key===' '?'Space':key.key;}
function virtualKeyName(vk:number){
  if(vk>=0x30&&vk<=0x39||vk>=0x41&&vk<=0x5a)return String.fromCharCode(vk);
  if(vk>=0x70&&vk<=0x87)return `F${vk-0x6f}`;
  return ({8:'Backspace',9:'Tab',13:'Enter',27:'Escape',32:'Space',33:'PageUp',34:'PageDown',35:'End',36:'Home',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',46:'Delete'} as Record<number,string>)[vk]||'';
}
function formatShortcut(key:Key){
  const name=keyName(key);
  if(!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.test(name))return '';
  return [key.ctrlKey?'Ctrl':'',key.altKey?'Alt':'',key.shiftKey?'Shift':'',key.metaKey?'Win':'',name].filter(Boolean).join('+');
}

/** Capture Windows combinations before the shell or another application consumes them. */
export function setupShortcut(input:HTMLInputElement,onError:(error:unknown)=>void=toast,options?:{onRetry?:()=>void}){
  input.readOnly=true;input.classList.add('shortcut-input');input.placeholder='点击录入快捷键';
  let original='',recording=false,token='',waitingForRelease=false;
  let checkRevision=0,status={active:false,error:''},conflictDetail='';
  const field=document.createElement('div');field.className='shortcut-field';
  const control=document.createElement('div');control.className='shortcut-control';
  input.replaceWith(field);field.append(control);control.append(input);
  const clear=document.createElement('button');clear.className='icon-button quiet';clear.type='button';clear.title='清除快捷键';clear.setAttribute('aria-label','清除快捷键');clear.innerHTML=icon('close');control.append(clear);
  const notice=document.createElement('div');notice.id=`${input.id}-notice`;notice.className='shortcut-conflict-notice';notice.setAttribute('role','status');notice.hidden=true;
  const message=document.createElement('span');message.id=`${input.id}-message`;notice.innerHTML=icon('info');notice.append(message);
  const retry=document.createElement('button');retry.id=`${input.id}-retry`;retry.type='button';retry.textContent='重试';retry.hidden=true;retry.onclick=options?.onRetry||null;notice.append(retry);field.append(notice);
  const renderNotice=()=>{const value=conflictDetail?(status.error.includes('已被占用')?`快捷键已被占用：${conflictDetail}`:status.error?`${status.error}；${conflictDetail}`:`快捷键已被占用：${conflictDetail}`):status.error;notice.hidden=!value;message.textContent=value;retry.hidden=!status.error||!options?.onRetry;if(value){input.setAttribute('aria-describedby',message.id);input.setAttribute('aria-invalid','true');}else{input.removeAttribute('aria-describedby');input.removeAttribute('aria-invalid');}};
  const setStatus=(next:{active:boolean;error:string})=>{status=next;if(next.active&&!next.error)conflictDetail='';renderNotice();};
  const finish=()=>{if(!recording)return;recording=false;waitingForRelease=false;input.classList.remove('recording');input.placeholder='点击录入快捷键';void api.recordShortcut(false,token).catch(onError);};
  const accept=(key:Key)=>{
    if(key.key==='Escape'){input.value=original;input.blur();return;}
    if((key.key==='Backspace'||key.key==='Delete')&&!key.ctrlKey&&!key.altKey&&!key.metaKey){input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));waitingForRelease=true;return;}
    const shortcut=formatShortcut(key);if(!shortcut)return;
    input.value=shortcut;input.dispatchEvent(new Event('change',{bubbles:true}));const revision=++checkRevision;
    void api.hotkeyConflict(shortcut,input.id).then(result=>{if(revision!==checkRevision||input.value!==shortcut||status.active)return;conflictDetail=result.label;renderNotice();}).catch(()=>{});
    waitingForRelease=true;
  };
  input.addEventListener('change',()=>{checkRevision++;status={active:false,error:''};conflictDetail='';renderNotice();});
  input.addEventListener('focus',()=>{original=input.value;recording=true;waitingForRelease=false;token=`${Date.now()}-${Math.random()}`;const requestToken=token;input.classList.add('recording');input.placeholder='按下组合键';void api.recordShortcut(true,requestToken).catch(error=>{if(recording&&token===requestToken)onError(error);});});
  input.addEventListener('blur',finish);
  window.addEventListener('blur',finish);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();});
  input.addEventListener('pointerdown',()=>{if(document.activeElement===input&&!recording)input.dispatchEvent(new Event('focus'));});
  input.addEventListener('keydown',event=>{if(event.key==='Tab')return;event.preventDefault();event.stopPropagation();if(['Control','Shift','Alt','Meta'].includes(event.key))return;accept(event);});
  input.addEventListener('keyup',()=>{if(waitingForRelease)input.blur();});
  api.onShortcutCaptured(event=>{
    if(!recording||event.token!==token)return;
    if(event.released){if(waitingForRelease)input.blur();return;}
    if(typeof event.vk!=='number')return;
    const key=virtualKeyName(event.vk);if(!key)return;
    accept({key,ctrlKey:!!event.ctrlKey,altKey:!!event.altKey,shiftKey:!!event.shiftKey,metaKey:!!event.metaKey});
  });
  clear.onclick=()=>{input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));};
  return {setStatus};
}
