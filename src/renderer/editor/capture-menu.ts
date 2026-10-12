import {openAnchoredPopover,closeAnchoredPopover,positionAnchoredPopover} from '../anchored-popover';
/** Screenshot menus share one owner and never participate in toolbar layout. */
let active:
  | { panel: HTMLElement; anchor: HTMLElement; side: boolean; close?: () => void }
  | undefined;
const isolated = new WeakSet<HTMLElement>();
const menuBottom=(anchor:HTMLElement)=>()=>anchor.closest('.editor-commandbar')?Math.min(innerHeight-8,document.querySelector('.editor-footer')?.getBoundingClientRect().top??innerHeight-8):innerHeight-8;

export function closeCaptureMenu(restoreFocus = false) {
  if (!active) return;
  const previous = active;
  active = undefined;
  previous.anchor.setAttribute('aria-expanded', 'false');
  void closeAnchoredPopover(previous.panel,{immediate:true});
  previous.panel.hidden = true;
  previous.close?.();
  if (restoreFocus) previous.anchor.focus({ preventScroll: true });
}

export function positionCaptureMenu() {
  if (!active) return;
  const { panel, anchor, side } = active;
  if (
    !anchor.isConnected ||
    !anchor.getClientRects().length ||
    (anchor as HTMLButtonElement).disabled
  ) {
    closeCaptureMenu();
    return;
  }
  if(!positionAnchoredPopover(anchor,panel,{preferred:side?'right':'below',gap:side?8:6,maxHeight:()=>innerHeight-16,bottom:menuBottom(anchor)}))closeCaptureMenu();
}

export function toggleCaptureMenu(
  panel: HTMLElement,
  anchor: HTMLElement,
  options: { side?: boolean; close?: () => void } = {},
) {
  const wasOpen = active?.panel === panel;
  closeCaptureMenu();
  if (wasOpen || (anchor as HTMLButtonElement).disabled) return;
  active = { panel, anchor, side: !!options.side, close: options.close };
  if (!isolated.has(panel)) {
    isolated.add(panel);
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'dblclick',
      'contextmenu',
      'wheel',
    ])
      panel.addEventListener(type, (event) => event.stopPropagation(), {
        passive: type === 'wheel',
      });
  }
  panel.classList.add('capture-menu');
  panel.hidden=false;anchor.setAttribute('aria-expanded','true');
  if(!openAnchoredPopover(anchor,panel,{preferred:options.side?'right':'below',gap:options.side?8:6,width:panel.offsetWidth,maxHeight:()=>innerHeight-16,bottom:menuBottom(anchor),onDetach:closeCaptureMenu}))return;
  panel
    .querySelector<HTMLElement>('button:not(:disabled),input:not([hidden]),[tabindex="0"]')
    ?.focus({ preventScroll: true });
}

document.addEventListener(
  'pointerdown',
  (event) => {
    if (!active || !(event.target instanceof Element)) return;
    if (
      active.panel.contains(event.target) ||
      active.anchor.contains(event.target) ||
      event.target.closest('.select-popup,.color-picker-panel')
    )
      return;
    closeCaptureMenu();
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (
      !active ||
      !(event.target instanceof Element) ||
      event.target.closest('.select-popup,.color-picker-panel,[role=combobox][aria-expanded=true]')
    )
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCaptureMenu(true);
      return;
    }
    if (!active.panel.contains(event.target)) return;
    if (event.key === 'Tab') {
      const controls = [
        ...active.panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not([hidden]),[tabindex="0"]',
        ),
      ].filter((node) => node.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    } else if (
      active.panel.role === 'menu' &&
      ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const buttons = [
          ...active.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ],
        current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  },
  true,
);
window.addEventListener('resize', positionCaptureMenu);
