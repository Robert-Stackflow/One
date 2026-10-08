import {api,icon,toast} from './ui';
import {dialogMarkup,openDialog,closeDialog} from './dialog';

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
  let checkRevision=0,status={active:false,error:''},conflictDetail='',conflictSource:'one'|'external'|'none'='none';
  let diagnosis='',diagnosisBusy=false,manualAvailable=false,elevatedAvailable=false,ownerPath='',ownerPid=0;
  const field=document.createElement('div');field.className='shortcut-field';
  const control=document.createElement('div');control.className='shortcut-control';
  input.replaceWith(field);field.append(control);control.append(input);
  const clear=document.createElement('button');clear.className='icon-button quiet';clear.type='button';clear.title='清除快捷键';clear.setAttribute('aria-label','清除快捷键');clear.innerHTML=icon('close');control.append(clear);
  const notice=document.createElement('div');notice.id=`${input.id}-notice`;notice.className='shortcut-conflict-notice';notice.setAttribute('role','status');notice.hidden=true;
  const message=document.createElement('span');message.id=`${input.id}-message`;notice.innerHTML=icon('info');notice.append(message);
  const details=document.createElement('button');details.id=`${input.id}-details`;details.type='button';details.textContent='详情';notice.append(details);field.append(notice);
  const template=document.createElement('template');template.innerHTML=dialogMarkup({id:`${input.id}-details-dialog`,title:'快捷键冲突详情',className:'shortcut-detail-dialog',body:`
    <div class="shortcut-detail-row"><span>组合键</span><strong data-shortcut-key></strong></div>
    <div class="shortcut-detail-row"><span>当前状态</span><p data-shortcut-status></p></div>
    <div class="shortcut-detail-process" data-shortcut-process hidden><div class="shortcut-detail-row"><span>接收进程</span><strong data-shortcut-owner></strong></div><div class="shortcut-detail-row"><span>进程路径</span><code data-shortcut-path></code></div></div>
    <p class="shortcut-detail-explanation" data-shortcut-explanation></p>
    <div class="shortcut-detail-actions"><button type="button" data-shortcut-auto>自动定位</button><button type="button" data-shortcut-manual hidden>手动测试</button><button type="button" data-shortcut-elevated hidden>管理员范围</button><button type="button" id="${input.id}-retry" data-shortcut-retry hidden>重试</button></div>
    <small class="shortcut-detail-footnote">自动定位会模拟发送一次组合键，其他程序仍可能响应。管理员范围只提升诊断辅助进程。</small>`});
  const dialog=template.content.firstElementChild as HTMLDialogElement;document.body.append(dialog);
  const locate=dialog.querySelector<HTMLButtonElement>('[data-shortcut-auto]')!;
  const manual=dialog.querySelector<HTMLButtonElement>('[data-shortcut-manual]')!;
  const elevated=dialog.querySelector<HTMLButtonElement>('[data-shortcut-elevated]')!;
  const retry=dialog.querySelector<HTMLButtonElement>('[data-shortcut-retry]')!;retry.onclick=options?.onRetry||null;
  const renderDetail=()=>{
    dialog.querySelector<HTMLElement>('[data-shortcut-key]')!.textContent=input.value||'未设置';
    dialog.querySelector<HTMLElement>('[data-shortcut-status]')!.textContent=ownerPid?'已定位到热键接收进程':diagnosis||[status.error,conflictDetail].filter(Boolean).join('；')||'当前快捷键可用';
    const process=dialog.querySelector<HTMLElement>('[data-shortcut-process]')!;process.hidden=!ownerPid;
    dialog.querySelector<HTMLElement>('[data-shortcut-owner]')!.textContent=ownerPid?`${ownerPath.split(/[\\/]/).pop()||'未知程序'}（PID ${ownerPid}）`:'';
    dialog.querySelector<HTMLElement>('[data-shortcut-path]')!.textContent=ownerPath||'进程路径不可读取';
    dialog.querySelector<HTMLElement>('[data-shortcut-explanation]')!.textContent=ownerPid?'诊断器观察到该进程接收本次热键。使用键盘钩子的程序和 Windows 保留快捷键可能无法定位。':diagnosis.includes('未观察到')?'未观察到接收热键消息的进程，可能由系统、键盘钩子或前台程序处理。':'One 只能确认组合键目前无法注册；定位结果来自一次实际按键测试。';
    const canLocate=!!input.value&&(conflictSource==='external'||status.error.includes('已被占用')&&conflictSource!=='one');
    locate.hidden=!canLocate;manual.hidden=!canLocate||!manualAvailable;elevated.hidden=!canLocate||!elevatedAvailable;retry.hidden=!status.error||!options?.onRetry;
    locate.disabled=manual.disabled=elevated.disabled=diagnosisBusy;
  };
  const renderNotice=()=>{
    const full=[status.error,conflictDetail,diagnosis].filter(Boolean).join('；');
    const summary=diagnosisBusy?'正在检测接收进程…':ownerPid?`已定位：${ownerPath.split(/[\\/]/).pop()||`PID ${ownerPid}`}`:diagnosis.includes('未观察到')?'未定位到接收进程':status.error||conflictDetail?'快捷键已被占用':'';
    notice.hidden=!summary;message.textContent=summary;message.title=full;
    if(summary){input.setAttribute('aria-describedby',message.id);input.setAttribute('aria-invalid','true');}else{input.removeAttribute('aria-describedby');input.removeAttribute('aria-invalid');if(dialog.open)void closeDialog(dialog);}
    renderDetail();
  };
  details.onclick=()=>{renderDetail();openDialog(dialog);};
  const setStatus=(next:{active:boolean;error:string})=>{status=next;if(next.active&&!next.error){conflictDetail='';conflictSource='none';diagnosis='';manualAvailable=false;elevatedAvailable=false;ownerPath='';ownerPid=0;}renderNotice();};
  const finish=()=>{if(!recording)return;recording=false;waitingForRelease=false;input.classList.remove('recording');input.placeholder='点击录入快捷键';void api.recordShortcut(false,token).catch(onError);};
  const accept=(key:Key)=>{
    if(key.key==='Escape'){input.value=original;input.blur();return;}
    if((key.key==='Backspace'||key.key==='Delete')&&!key.ctrlKey&&!key.altKey&&!key.metaKey){input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));waitingForRelease=true;return;}
    const shortcut=formatShortcut(key);if(!shortcut)return;
    input.value=shortcut;input.dispatchEvent(new Event('change',{bubbles:true}));const revision=++checkRevision;
    void api.hotkeyConflict(shortcut,input.id).then(result=>{if(revision!==checkRevision||input.value!==shortcut||status.active)return;conflictDetail=result.label;conflictSource=result.source;renderNotice();}).catch(()=>{});
    waitingForRelease=true;
  };
  input.addEventListener('change',()=>{checkRevision++;status={active:false,error:''};conflictDetail='';conflictSource='none';diagnosis='';manualAvailable=false;elevatedAvailable=false;ownerPath='';ownerPid=0;renderNotice();});
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
  const diagnose=async(mode:'auto'|'manual',asAdministrator=false)=>{
    if(diagnosisBusy||!input.value)return;
    finish();const shortcut=input.value,revision=checkRevision;
    diagnosisBusy=true;diagnosis=asAdministrator?'正在启动管理员范围检测…':mode==='auto'?'正在自动检测…':'请在 10 秒内按下组合键…';manualAvailable=false;elevatedAvailable=false;ownerPath='';ownerPid=0;renderNotice();
    try{const result=await api.hotkeyOwner(shortcut,mode,asAdministrator);if(revision!==checkRevision||input.value!==shortcut)return;
      if(result.status==='found'){
        const name=result.path.split(/[\\/]/).pop()||'未知程序';
        diagnosis=`接收进程：${name}（PID ${result.pid}）${result.partial?'；32 位程序检测不完整':''}`;
        ownerPath=result.path;ownerPid=result.pid;
      }else if(result.status==='not-found'){
        diagnosis=`未观察到接收该热键的进程${result.partial?'（32 位程序检测不完整）':''}；也可能由系统或键盘钩子处理`;
        manualAvailable=mode==='auto';elevatedAvailable=!asAdministrator;
      }else if(result.status==='cancelled'){diagnosis='已取消管理员授权';elevatedAvailable=true;}
      else{diagnosis=result.message;manualAvailable=mode==='auto';elevatedAvailable=!asAdministrator;}
    }catch(error){if(revision===checkRevision&&input.value===shortcut){diagnosis=(error as Error).message||'热键诊断失败';manualAvailable=mode==='auto';elevatedAvailable=!asAdministrator;}}
    finally{diagnosisBusy=false;renderNotice();}
  };
  locate.onclick=()=>void diagnose('auto');manual.onclick=()=>void diagnose('manual');elevated.onclick=()=>void diagnose('auto',true);
  return {setStatus};
}
