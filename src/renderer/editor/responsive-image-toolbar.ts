import { Ellipsis, createElement } from 'lucide';
import { imageTools } from './annotation-tools';
import type { CaptureTool } from '../../shared/capture/image-document';
import { closeCaptureMenu, toggleCaptureMenu } from './capture-menu';

/** Keep history visible while less frequent tools overflow into the shared menu. */
export function responsiveImageToolbar(bar: HTMLElement, choose: (tool: CaptureTool) => void) {
  const nav = bar.querySelector<HTMLElement>('#annotation-tools')!;
  const candidates = [
    ...nav.querySelectorAll<HTMLElement>('.capture-tool-family'),
    bar.querySelector<HTMLElement>('.image-transform-tools')!,
  ];
  const more = document.createElement('button');
  more.id = 'image-toolbar-more';
  more.type = 'button';
  more.className = 'quiet';
  more.title = more.ariaLabel = '更多工具';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.append(createElement(Ellipsis, { class: 'icon', 'aria-hidden': 'true' }));
  bar.insertBefore(more, bar.querySelector('.actions'));
  let hidden: HTMLElement[] = [];
  const dividers = () => {
    for (const line of nav.querySelectorAll<HTMLElement>('.capture-divider'))
      line.hidden =
        !!(line.previousElementSibling as HTMLElement)?.hidden ||
        !!(line.nextElementSibling as HTMLElement)?.hidden;
  };
  const layout = () => {
    const previous = hidden.map((e) => candidates.indexOf(e)).join(',');
    hidden = [];
    for (const item of candidates) item.hidden = false;
    more.hidden = true;
    dividers();
    if (bar.scrollWidth > bar.clientWidth) {
      more.hidden = false;
      for (const item of [...candidates].reverse()) {
        if (bar.scrollWidth <= bar.clientWidth) break;
        item.hidden = true;
        hidden.unshift(item);
        dividers();
      }
    }
    if (previous !== hidden.map((e) => candidates.indexOf(e)).join(',')) closeCaptureMenu();
  };
  more.onclick = () => {
    if (more.getAttribute('aria-expanded') === 'true') return closeCaptureMenu();
    const menu = document.createElement('div');
    menu.className = 'capture-tool-menu capture-panel';
    menu.setAttribute('role', 'menu');
    menu.ariaLabel = '更多工具';
    for (const item of hidden) {
      if (item.dataset.tools) {
        for (const tool of item.dataset.tools.split(' ') as CaptureTool[]) {
          const [, label, glyph] = imageTools.find((entry) => entry[0] === tool)!;
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.tool = tool;
          button.setAttribute('role', 'menuitem');
          button.append(
            createElement(glyph, { class: 'icon', 'aria-hidden': 'true' }),
            document.createTextNode(tool === 'select' ? '裁剪区域' : label),
          );
          button.onclick = () => {
            closeCaptureMenu();
            choose(tool);
            more.focus();
          };
          menu.append(button);
        }
      } else {
        for (const source of item.querySelectorAll<HTMLButtonElement>('button')) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.command = source.id;
          button.setAttribute('role', 'menuitem');
          button.disabled = source.disabled;
          button.append(
            ...[...source.childNodes].map((node) => node.cloneNode(true)),
            document.createTextNode(source.ariaLabel || source.title),
          );
          button.onclick = () => {
            closeCaptureMenu();
            source.click();
            more.focus();
          };
          menu.append(button);
        }
      }
    }
    document.body.append(menu);
    toggleCaptureMenu(menu, more, { close: () => menu.remove() });
  };
  const observer = new ResizeObserver(layout);
  observer.observe(bar);
  addEventListener('beforeunload', () => observer.disconnect());
  layout();
}
