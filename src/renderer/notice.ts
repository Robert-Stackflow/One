import {icon} from './icons';

/** A shared, dismissible message surface. Existing message text remains the live region. */
export function mountNotice(message: HTMLElement, onDismiss=()=>{message.textContent='';}) {
  if (message.closest('.notice-banner')) return;
  const root = document.createElement('div');
  root.className = 'notice-banner';
  root.hidden = true;
  const symbol = document.createElement('span');
  symbol.className = 'notice-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'quiet notice-dismiss';
  dismiss.setAttribute('aria-label', '关闭提示');
  dismiss.innerHTML=icon('close');
  message.before(root);
  message.classList.add('notice-message');
  root.append(symbol, message, dismiss);
  let tone = '';
  const sync = () => {
    const text = message.textContent?.trim() || '';
    const nextTone = /拒绝|无法|失败|错误|中断|权限|denied|failed/i.test(text) ? 'warning' : 'info';
    if (tone !== nextTone) {
      tone = nextTone;
      root.dataset.tone = tone;
      symbol.innerHTML=icon(tone === 'warning' ? 'alert' : 'info');
    }
    root.hidden = message.hidden || !text;
  };
  dismiss.onclick = () => {
    onDismiss();
  };
  root.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss.click();
    }
  };
  const observer=new MutationObserver(sync);
  observer.observe(message, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  sync();
  return()=>{observer.disconnect();root.onkeydown=null;dismiss.onclick=null;root.hidden=true;};
}
