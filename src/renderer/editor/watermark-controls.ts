import type { Annotation } from '../../shared/capture/image-document';
import {
  watermarkStyle,
  watermarkText,
  watermarkTimeFormats,
  type WatermarkImage,
  type WatermarkStyle,
} from '../../shared/capture/watermark';
import { customControls } from '../controls';

interface WatermarkHost {
  locked(): boolean;
  current(): Annotation | undefined;
  timestamp(): number;
  image(): WatermarkImage | undefined;
  fillImage(image: WatermarkImage | undefined): void;
  update(style: Partial<Annotation>, preview: boolean): void;
  refresh(): void;
  error(error: unknown): void;
}
/** Shared watermark fields, date insertion, validation and preview/commit behavior. */
export function watermarkControls(root: ParentNode, host: WatermarkHost) {
  const field = <T extends HTMLElement = HTMLInputElement>(id: string) =>
    root.querySelector<T>('#' + id)!;
  const date = field<HTMLButtonElement>('watermark-date');
  const timeControls = document.createElement('div');
  timeControls.id = 'watermark-time-controls';
  timeControls.className = 'watermark-time-controls';
  timeControls.innerHTML = `<label>时间格式<select id="watermark-time-format" aria-label="水印时间格式">${watermarkTimeFormats.map(({ name, format }) => `<option value="${format}">${name}</option>`).join('')}</select></label><div class="watermark-time-insert"><output aria-label="水印时间预览"></output></div>`;
  date.before(timeControls);
  timeControls.querySelector('.watermark-time-insert')!.append(date);
  const format = timeControls.querySelector<HTMLSelectElement>('select')!;
  const preview = () => {
    timeControls.querySelector('output')!.textContent = watermarkText(
      '$' + format.value + '$',
      host.current()?.watermark?.capturedAt ?? host.timestamp(),
    );
  };
  format.onchange = preview;
  customControls(timeControls);
  const read = (): WatermarkStyle =>
    watermarkStyle({
      position: field<HTMLSelectElement>('watermark-position').value,
      opacity: Number(field<HTMLInputElement>('watermark-opacity').value) / 100,
      angle: Number(field<HTMLInputElement>('watermark-angle').value),
      spacing: Number(field<HTMLInputElement>('watermark-spacing').value),
      capturedAt: host.current()?.watermark?.capturedAt ?? host.timestamp(),
      image: host.image(),
    });
  const refresh = () => {
    field('watermark-spacing-field').hidden =
      field<HTMLSelectElement>('watermark-position').value !== 'tile';
    preview();
  };
  const fill = (style: WatermarkStyle, text: string) => {
    host.fillImage(style.image);
    field<HTMLInputElement>('watermark-text').value = text;
    field<HTMLSelectElement>('watermark-position').value = style.position;
    field<HTMLInputElement>('watermark-opacity').value = String(style.opacity * 100);
    field<HTMLInputElement>('watermark-angle').value = String(style.angle);
    field<HTMLInputElement>('watermark-spacing').value = String(style.spacing);
    refresh();
  };
  for (const id of [
    'watermark-text',
    'watermark-position',
    'watermark-opacity',
    'watermark-angle',
    'watermark-spacing',
  ]) {
    const input = field<HTMLInputElement | HTMLSelectElement>(id);
    const update = (preview: boolean) => {
      if (host.locked() || !input.checkValidity()) return;
      try {
        host.update(
          { text: field<HTMLInputElement>('watermark-text').value, watermark: read() },
          preview,
        );
        refresh();
        host.refresh();
      } catch (error) {
        host.error(error);
      }
    };
    input.addEventListener('input', () => update(true));
    input.addEventListener('change', () => update(false));
  }
  date.textContent = '插入时间';
  date.classList.add('watermark-date-action');
  date.title = '插入本次图片日期和时间；已有工程保留原日期';
  date.onclick = () => {
    if (host.locked()) return;
    const input = field<HTMLInputElement>('watermark-text'),
      value = input.value + (input.value ? ' ' : '') + '$' + format.value + '$';
    if (value.length > input.maxLength) return host.error('水印文字过长，请先删减内容');
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { read, fill, refresh };
}
