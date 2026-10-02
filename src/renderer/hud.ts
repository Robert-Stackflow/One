import {api,q,esc,icon,iconButton} from './ui';
import {hudContent,type EchoFrame} from '../shared/hud';
export function renderHUD(){
  document.documentElement.classList.add('transparent-root');document.body.className='echo';q('app').innerHTML='<div class="hud-stage"><div id="echo-label" class="hud" hidden></div></div>';
  const node=q('echo-label');
  if(new URLSearchParams(location.search).has('edit')){
    document.body.classList.add('echo-editing');node.hidden=false;node.className='hud echo-position-panel drag-region';node.setAttribute('aria-label','拖动黑框调整所有提示的位置');node.innerHTML=`<div class="echo-position-copy"><strong>Ctrl + Shift + A</strong><span>${icon('move')}拖动调整位置</span></div><div class="echo-position-buttons">${iconButton('echo-position-done','完成调整（Enter）','check')}${iconButton('echo-position-cancel','关闭调整（Esc）','close')}</div><span id="echo-position-error" role="alert" hidden></span>`;
    q('echo-position-done').onclick=()=>{const done=q<HTMLButtonElement>('echo-position-done');done.disabled=true;void api.finishEchoPosition().catch(error=>{done.disabled=false;const message=q('echo-position-error');message.hidden=false;message.textContent=String(error);});};q('echo-position-cancel').onclick=()=>void api.closeWindow();
    window.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();q('echo-position-done').click();}if(e.key==='Escape'){e.preventDefault();q('echo-position-cancel').click();}});return;
  }
  let mode='',entryAnimation:Animation|undefined,lockRevision=0;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  api.onEcho((value:string|EchoFrame)=>{
    const frame=typeof value==='string'?{text:value,enter:node.hidden,channel:undefined}:value;
    const content=hudContent(frame.text,frame.channel),nextMode=content.kind+(content.kind==='level'?content.action:content.kind==='lock'?content.label:'');
    const changed=mode!==nextMode;mode=nextMode;node.className='hud hud-'+content.kind;node.hidden=false;node.dataset.visibility='shown';node.setAttribute('role','status');node.setAttribute('aria-label',frame.text);
    if(content.kind==='level'){
      if(changed)node.innerHTML=`<span class="hud-symbol">${icon(content.action)}</span><span class="hud-track"><i></i></span><strong class="hud-percent"></strong>`;
      node.querySelector<HTMLElement>('.hud-track i')!.style.transform=`scaleX(${content.value/100})`;node.querySelector('.hud-percent')!.textContent=content.value+'%';
    }else if(content.kind==='lock'){
      if(changed)node.innerHTML=`<span class="hud-lock-icon">${icon('lock')}</span><strong class="hud-status-label">${esc(content.label)}</strong><span class="hud-status-value"></span>`;
      node.querySelector('.hud-status-value')!.textContent=content.enabled?'开启':'关闭';const revision=++lockRevision;
      if(changed&&!reduced()){node.dataset.locked=String(!content.enabled);requestAnimationFrame(()=>requestAnimationFrame(()=>{if(revision===lockRevision)node.dataset.locked=String(content.enabled);}));}else node.dataset.locked=String(content.enabled);
    }else if(content.kind==='keys'){
      node.innerHTML=content.keys.map(key=>`<kbd${/^(Ctrl|Alt|Shift|Win|Super|Meta)$/i.test(key)?' class="modifier"':''}>${esc(key)}</kbd>`).join('<span class="hud-key-separator">+</span>');
    }else if(content.kind==='ime'){
      if(changed)node.innerHTML='<span class="hud-ime-badge"></span><span class="hud-ime-name"></span>';
      node.querySelector('.hud-ime-badge')!.textContent=content.mode;node.querySelector('.hud-ime-name')!.textContent=content.language;
    }else node.innerHTML=`<span class="hud-message">${esc(content.text)}</span>`;
    if(frame.enter){entryAnimation?.cancel();if(!reduced())entryAnimation=node.animate([{opacity:0},{opacity:1}],{duration:140,easing:'ease-out'});}
  });
  api.onEchoHide(()=>{entryAnimation?.cancel();node.dataset.visibility='hiding';});
}
