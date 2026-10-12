import './watermark-toolbar.css';
import { closeCaptureMenu, toggleCaptureMenu } from './capture-menu';
import { imageAnnotationIds } from './annotation-config';
import {selectSource} from '../controls';

/** Shared compact watermark menus retain the existing preview/commit controls. */
export function watermarkToolbar(root: HTMLElement, editor = false) {
  const ids = editor ? imageAnnotationIds : {};
  const field = (id: string) => document.getElementById(ids[id] || id)!;
  const label = (id: string) => field(id).closest<HTMLElement>('label,.capture-property')!;
  const bar = document.createElement('div');
  bar.className = 'watermark-toolbar';
  bar.hidden = true;
  root.append(bar);
  const groups = [
    {
      name: '内容',
      kind: 'content',
      fields: [
        field('watermark-image-controls'),
        label('watermark-text'),
        field('watermark-time-controls'),
      ],
    },
    {
      name: '文字样式',
      kind: 'type',
      fields: [
        ...['mark-color', 'mark-family', 'mark-font', 'mark-weight'].map(label),
        root.querySelector<HTMLElement>('[data-text-emphasis]')!,
      ],
    },
    {
      name: '布局',
      kind: 'layout',
      fields: [
        'watermark-position',
        'watermark-opacity',
        'watermark-angle',
        'watermark-spacing',
      ].map(label),
    },
  ].map(({ name, kind, fields }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'watermark-menu-button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-haspopup', 'dialog');
    const title = document.createElement('span'),
      detail = document.createElement('span');
    title.textContent = name;
    detail.className = 'watermark-menu-detail';
    button.append(title, detail);
    const panel = document.createElement('section');
    panel.className = `watermark-menu watermark-menu-${kind}`;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '水印' + name);
    const header = document.createElement('header'),
      heading = document.createElement('strong'),
      close = document.createElement('button');
    header.className = 'watermark-menu-header';
    heading.textContent = '水印' + name;
    close.type = 'button';
    close.className = 'watermark-menu-close';
    close.ariaLabel = '关闭水印' + name;
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m7 7 10 10M17 7 7 17"/></svg>';
    close.onclick = () => closeCaptureMenu(true);
    header.append(heading, close);
    const body = document.createElement('div');
    body.className = 'watermark-menu-fields annotation-properties';
    panel.append(header, body);
    document.body.append(panel);
    bar.append(button);
    button.onclick = () => toggleCaptureMenu(panel, button);
    return {
      name,
      button,
      panel,
      body,
      detail,
      fields: fields.map((element) => {
        const place = document.createComment('watermark-control');
        element.before(place);
        return { element, place };
      }),
    };
  });
  let active = false;
  const sync = (enabled: boolean, image = false) => {
    if (enabled !== active) {
      closeCaptureMenu();
      active = enabled;
      for (const group of groups)
        for (const { element, place } of group.fields)
          if (enabled) group.body.append(element);
          else place.after(element);
    }
    bar.hidden = !enabled;
    root.classList.toggle('watermark-property-strip', enabled);
    groups[1].button.disabled = image;
    groups[1].button.title = image ? '文字样式适用于文字水印' : '';
    groups[0].detail.textContent = image
      ? '图片'
      : (field('watermark-text') as HTMLInputElement).value || '文字';
    const position = selectSource(field('watermark-position'))!;
    groups[2].detail.textContent = position.selectedOptions[0]?.textContent || '';
    field('watermark-time-controls').hidden = !enabled || image;
    if (image && groups[1].button.getAttribute('aria-expanded') === 'true') closeCaptureMenu();
  };
  return { sync };
}
