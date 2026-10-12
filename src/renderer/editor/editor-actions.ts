import { createElement, Ellipsis, FolderDown, ScanText, Download } from 'lucide';
import { closeCaptureMenu, toggleCaptureMenu } from './capture-menu';

/** Reuses the original action buttons so busy/disabled states and handlers stay intact. */
export function editorMoreActions(actions: HTMLElement, ids: string[]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'editor-more';
  button.className = 'quiet editor-more';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', '更多操作');
  button.title = '更多操作';
  button.append(createElement(Ellipsis, { 'aria-hidden': 'true' }));
  const panel = document.createElement('div');
  panel.className = 'editor-actions-menu editor-popover';
  panel.id = 'editor-more-menu';
  panel.hidden = true;
  panel.role = 'menu';
  button.setAttribute('aria-controls', panel.id);
  const icons = { 'save-project': FolderDown, ocr: ScanText, export: Download } as const;
  for (const id of ids) {
    const action = document.getElementById(id) as HTMLButtonElement | null;
    if (!action) continue;
    action.role = 'menuitem';
    const icon = icons[id as keyof typeof icons];
    if (icon) action.prepend(createElement(icon, { 'aria-hidden': 'true' }));
    action.addEventListener('click', () => closeCaptureMenu(true));
    panel.append(action);
  }
  actions.prepend(button);
  document.body.append(panel);
  button.onclick = () => toggleCaptureMenu(panel, button);
}
