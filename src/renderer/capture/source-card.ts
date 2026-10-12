import { AppWindow, Monitor, Check, Camera } from 'lucide';
import { icon, registerIcons } from '../ui';

registerIcons({ monitor: Monitor, window: AppWindow, check: Check, camera: Camera });
const escape = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
/** Capture and recording deliberately share the same card markup and styling. */
export function sourceCard(value: {
  key: string | number;
  attribute: 'data-display' | 'data-capture-window' | 'data-id' | 'data-camera';
  name: string;
  thumbnail?: string;
  meta?: string;
  selected?: boolean;
  disabled?: boolean;
  kind: 'screen' | 'window' | 'camera';
  previewKey?: number;
}) {
  return `<button type="button" class="display-card${value.selected ? ' selected' : ''}" ${value.attribute}="${escape(value.key)}" aria-pressed="${!!value.selected}" title="${escape(value.name)}" ${value.disabled ? 'disabled' : ''}><span class="display-preview" ${value.previewKey === undefined ? '' : `data-display-preview="${value.previewKey}"`}>${value.thumbnail ? `<img src="${escape(value.thumbnail)}" alt="" draggable="false">` : icon('lucide:' + (value.kind === 'screen' ? 'monitor' : value.kind === 'camera' ? 'camera' : 'window'))}</span><span class="display-card-caption"><span><strong>${escape(value.name)}</strong>${value.meta ? `<small>${escape(value.meta)}</small>` : ''}</span><span class="source-check">${icon('lucide:check')}</span></span></button>`;
}
export function bindSourceCardPreviews(root: HTMLElement) {
  for (const image of root.querySelectorAll<HTMLImageElement>('.display-preview img'))
    image.onerror = () =>
      image.replaceWith(
        ...new DOMParser().parseFromString(icon('lucide:monitor'), 'text/html').body.childNodes,
      );
}
