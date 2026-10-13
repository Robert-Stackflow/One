import { mountNotice } from './notice';
import {onRemoval} from './dom-lifecycle';
import {popupMotion} from './popup-motion';

interface FeedbackMotion {
  revision: number;
  animation?: Animation;
  sync?: () => void;
  disposed?: boolean;
  inline?: boolean;
  cleanup: (() => void)[];
}
const motions = new WeakMap<HTMLElement, FeedbackMotion>();
function motionState(element: HTMLElement) {
  let state = motions.get(element);
  if (!state) {
    state = { revision: 0,cleanup:[] };
    motions.set(element, state);
    element.classList.add('feedback-motion');
    state.cleanup.push(onRemoval(element,()=>disposeFeedback(element)));
  }
  return state;
}
/** Stop observers, animation and timeouts when a page or a message surface is discarded. */
export function disposeFeedback(element:HTMLElement){
  const state=motions.get(element);if(!state||state.disposed)return;
  state.disposed=true;++state.revision;state.animation?.cancel();state.animation=undefined;state.sync=undefined;
  for(const dispose of state.cleanup.splice(0))dispose();
  if(element.matches(':popover-open'))element.hidePopover();
}
export const feedbackMessage=(message:unknown)=>String(message instanceof Error?message.message:message)
  .replace(/^Error: /,'').replace(/^Error invoking remote method '[^']+': Error: /,'');
function animateFeedback(
  element: HTMLElement,
  phase: 'enter' | 'update' | 'exit',
  finish?: () => void,
) {
  const state = motionState(element),
    revision = ++state.revision,
    style = getComputedStyle(element),
    interrupted = !!state.animation;
  const opacity = interrupted
    ? style.opacity
    : phase === 'enter'
      ? '0'
      : phase === 'update'
        ? '.78'
        : '1';
  const shift = document.documentElement.dataset.toastPosition?.startsWith('top') ? -4 : 4;
  const translate = interrupted
    ? style.translate
    : phase === 'enter'
      ? `0 ${shift}px`
      : phase === 'update'
        ? '0 2px'
        : '0 0';
  state.animation?.cancel();
  state.animation = undefined;
  element.dataset.feedbackPhase = phase;
  const done = () => {
    if (state.revision !== revision) return;
    state.animation?.cancel();
    state.animation = undefined;
    element.dataset.feedbackPhase = phase === 'exit' ? 'hidden' : 'visible';
    finish?.();
  };
  if (matchMedia('(prefers-reduced-motion:reduce)').matches || !element.isConnected) {
    done();
    return;
  }
  const animation = element.animate(
    [
      { opacity, translate },
      {
        opacity: phase === 'exit' ? 0 : 1,
        translate: phase === 'exit' ? `0 ${shift}px` : '0 0',
      },
    ],
    {
      ...popupMotion(style,phase === 'enter'),
      fill: 'both',
    },
  );
  state.animation = animation;
  void animation.finished.then(done, () => {});
}
/** A new message revokes an older exit before replacing its content. */
export function showFeedback(element: HTMLElement, render: () => void) {
  const state = motionState(element),
    visible = !element.hidden && !!element.textContent?.trim(),
    previous = element.textContent;
  if(state.disposed)return;
  render();
  element.hidden = false;
  state.sync?.();
  if (!visible || previous !== element.textContent || element.dataset.feedbackPhase === 'exit')
    animateFeedback(element, visible ? 'update' : 'enter');
}
export function dismissFeedback(element: HTMLElement, clear: () => void) {
  if(motions.get(element)?.disposed)return;
  if (element.hidden || !element.textContent?.trim()) {
    clear();
    if(!element.textContent?.trim())element.hidden=true;
    motions.get(element)?.sync?.();
    return;
  }
  animateFeedback(element, 'exit', () => {
    clear();
    if(!element.textContent?.trim())element.hidden=true;
    motions.get(element)?.sync?.();
  });
}

// Keep long diagnostics readable without forwarding navigation keys to history.
export function enableFeedbackScroll(element: HTMLElement) {
  const keydown = (event:KeyboardEvent) => {
    if(event.target!==element&&event.target instanceof Element&&event.target.closest('button,input,textarea,a,select'))return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const key = event.key;
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'Home') element.scrollTop = 0;
    else if (key === 'End') element.scrollTop = element.scrollHeight;
    else
      element.scrollTop +=
        (key === 'ArrowUp' || key === 'PageUp' ? -1 : 1) *
        (key === 'ArrowDown' || key === 'ArrowUp' ? 40 : element.clientHeight);
  };
  element.addEventListener('keydown',keydown);
  motionState(element).cleanup.push(()=>element.removeEventListener('keydown',keydown));
}
export function setupInlineFeedback(element: HTMLElement) {
  const state=motionState(element);if(state.inline||state.disposed)return;state.inline=true;
  const dismiss=()=>dismissFeedback(element,()=>{element.textContent='';});
  const disposeNotice=mountNotice(element,dismiss);if(disposeNotice)state.cleanup.push(disposeNotice);
  enableFeedbackScroll(element);
  const sync = () => (element.tabIndex = element.textContent?.trim() ? 0 : -1);
  const observer=new MutationObserver(sync);observer.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  sync();
  const keydown=(event:KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  };
  element.addEventListener('keydown',keydown);state.cleanup.push(()=>{observer.disconnect();element.removeEventListener('keydown',keydown);});
}

/** Keep short feedback above dialogs and outside the window's scrolling layout. */
export function setupFloatingFeedback(element: HTMLElement, contentDriven = false) {
  const state = motionState(element);
  if (state.sync||state.disposed) return;
  element.classList.add('feedback-toast');
  element.popover = 'manual';
  const sync = () => {
    const visible =
      element.isConnected && !element.hidden && (!contentDriven || !!element.textContent?.trim());
    if (contentDriven) element.tabIndex = visible ? 0 : -1;
    if (visible && !element.matches(':popover-open')) element.showPopover();
    else if (!visible && element.matches(':popover-open')) element.hidePopover();
  };
  state.sync = sync;
  const observer=new MutationObserver(sync);observer.observe(element, {
    attributes: true,
    attributeFilter: ['hidden'],
    childList: contentDriven,
    characterData: contentDriven,
    subtree: contentDriven,
  });
  state.cleanup.push(()=>observer.disconnect());
  if (contentDriven) {
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
    enableFeedbackScroll(element);
    const keydown=(event:KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissFeedback(element, () => (element.textContent = ''));
      }
    };
    element.addEventListener('keydown',keydown);state.cleanup.push(()=>element.removeEventListener('keydown',keydown));
  }
  sync();
}

/** Pause dismissal while a notification is being read with a pointer or keyboard. */
export function transientNotice(element: HTMLElement, duration = 7000) {
  const state=motionState(element);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let persistent = false;
  let pending = false;
  let delivery = 0;
  const reading = () => element.matches(':hover,:focus-within');
  const pause = () => clearTimeout(timer);
  const arm = () => {
    pause();
    if (!state.disposed&&!persistent&&!pending && !reading())
      timer = setTimeout(() => {
        if (!reading()) dismissFeedback(element, () => (element.textContent = ''));
      }, duration);
  };
  element.addEventListener('mouseenter', pause);
  element.addEventListener('focusin', pause);
  element.addEventListener('mouseleave', arm);
  element.addEventListener('focusout', arm);
  state.cleanup.push(()=>{pause();element.removeEventListener('mouseenter',pause);element.removeEventListener('focusin',pause);element.removeEventListener('mouseleave',arm);element.removeEventListener('focusout',arm);});
  return (value: unknown, keepVisible = false, action?: { label: string; run(): void|Promise<unknown> }) => {
    if(state.disposed)return;
    const messageRevision=++delivery;
    persistent = keepVisible;
    pending = false;
    element.setAttribute('aria-live','polite');
    element.setAttribute('aria-atomic','true');
    showFeedback(element, () => {
      element.textContent = feedbackMessage(value);
      if (action) {
        const text = document.createElement('span'),
          button = document.createElement('button');
        text.className = 'feedback-text';
        text.textContent = element.textContent;
        button.type = 'button';
        button.className = 'feedback-action quiet';
        button.textContent = action.label;
        button.onclick = () => {
          if(pending)return;
          pending=true;pause();button.disabled=true;
          void Promise.resolve().then(()=>action.run()).catch(error=>{
            if(!state.disposed&&delivery===messageRevision){text.textContent=feedbackMessage(error);persistent=true;pause();}
          }).finally(()=>{if(!state.disposed&&delivery===messageRevision){pending=false;button.disabled=false;arm();}});
        };
        element.replaceChildren(text, button);
      }
    });
    arm();
  };
}
