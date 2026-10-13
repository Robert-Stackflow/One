import {
  createElement,
  SlidersHorizontal,
  MousePointer2,
  AudioLines,
  Volume2,
  Clock,
  Camera,
  Keyboard,
  X,
  PencilLine,
  Film,
} from 'lucide';
import { closeControls } from '../controls';
import { openAnchoredPopover, closeAnchoredPopover } from '../anchored-popover';
import { closeCaptureMenu } from '../editor/capture-menu';

/** Labeled editing commands share the common anchored popup surface. */
export function playerToolbar() {
  const root = document.getElementById('player-properties')!;
  const toolbar = document.createElement('nav');
  toolbar.className = 'player-toolstrip';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '录制编辑工具');
  const entries = Array.from(root.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && !!node.id,
  );
  let active: HTMLElement | undefined;
  const buttons = new Map<HTMLElement, HTMLButtonElement>();
  const close = (focus = false) => {
    if (!active) return;
    const previous = active;
    active = undefined;
    previous.classList.remove('tool-panel-open');
    closeAnchoredPopover(previous);
    buttons.get(previous)?.setAttribute('aria-expanded', 'false');
    closeControls();
    if (focus) buttons.get(previous)?.focus({ preventScroll: true });
  };
  const tools = {
    'export-settings': ['导出', SlidersHorizontal],
    'cursor-settings': ['光标', MousePointer2],
    'source-settings': ['声音', AudioLines],
    'channel-settings': ['声道', Volume2],
    'time-settings': ['时间', Clock],
    'camera-preview-settings': ['画中画', Camera],
    'input-preview-settings': ['键鼠', Keyboard],
    'annotation-preview-settings': ['标注', PencilLine],
    'gif-editor': ['逐帧', Film],
  } as const;
  for (const panel of entries) {
    const title =
      panel.querySelector(':scope > summary, :scope > h2')?.textContent?.trim() ||
      panel.getAttribute('aria-label') ||
      '选项';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet player-tool';
    const tool = tools[panel.id as keyof typeof tools];
    const label = document.createElement('span');
    label.textContent = tool?.[0] || title;
    label.className = 'player-tool-label';
    if (tool) button.append(createElement(tool[1], { 'aria-hidden': 'true' }));
    button.append(label);
    button.setAttribute('aria-label', title);
    button.title = title;
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', 'false');
    button.hidden = panel.hidden;
    panel.classList.add('player-tool-panel', 'editor-popover');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    const heading = document.createElement('div');
    heading.className = 'tool-panel-heading';
    const caption = document.createElement('strong');
    caption.textContent = title;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'quiet';
    dismiss.setAttribute('aria-label', '关闭' + title);
    dismiss.append(createElement(X, { 'aria-hidden': 'true' }));
    dismiss.onclick = () => close(true);
    heading.append(caption, dismiss);
    panel.prepend(heading);
    button.onclick = () => {
      if (active === panel) {
        close();
        return;
      }
      close();
      closeControls();
      closeCaptureMenu();
      active = panel;
      panel.classList.add('tool-panel-open');
      openAnchoredPopover(
        button,
        panel,
        {mode: 'manual', width: panel.id === 'export-settings'
          ? 440
          : ['camera-preview-settings', 'input-preview-settings'].includes(panel.id)
            ? 420
            : 360,
        maxHeight: () =>
          Math.max(
            120,
            document.querySelector('.editor-footer')!.getBoundingClientRect().top -
              button.getBoundingClientRect().bottom -
              16,
          ),
        preferred: 'below', gap: 6,
        bottom: () => document.querySelector('.editor-footer')!.getBoundingClientRect().top - 8},
      );
      panel
        .querySelector<HTMLElement>('button:not(:disabled),[role=combobox],input:not(:disabled)')
        ?.focus({ preventScroll: true });
      button.setAttribute('aria-expanded', 'true');
    };
    buttons.set(panel, button);
    toolbar.append(button);
  }
  document.getElementById('player-commandbar')!.append(toolbar);
  const visibility = new MutationObserver((records) => {
    for (const record of records) {
      const panel = record.target as HTMLElement,
        button = buttons.get(panel);
      if (!button) continue;
      if (button.hidden !== panel.hidden) button.hidden = panel.hidden;
      if (panel.hidden && active === panel) close();
    }
  });
  for (const panel of buttons.keys())
    visibility.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !active ||
        !(event.target instanceof Element) ||
        active.contains(event.target) ||
        buttons.get(active)?.contains(event.target) ||
        event.target.closest('.select-popup,.color-picker-panel,.one-tooltip')
      )
        return;
      close();
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && active?.contains(event.target as Node)) {
      const fields = [
        ...active.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
        ),
      ].filter(
        (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden',
      );
      const first = fields[0],
        last = fields.at(-1);
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
    if (
      event.key === 'Escape' &&
      active &&
      !(
        event.target instanceof Element &&
        event.target.closest('.select-popup,.color-picker-panel,[role=combobox]')
      )
    ) {
      event.preventDefault();
      close(true);
    }
  });
}
