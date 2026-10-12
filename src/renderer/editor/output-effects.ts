import {
  defaultEffects,
  outputEffects,
  outputLayout,
  type OutputEffects,
} from '../../shared/capture/image-output';
import type { ImageDocument } from '../../shared/capture/image-document';
import { captureOutput } from './capture-paint';
import { customControls } from '../controls';
import { setupColorPicker } from '../color-picker';
import './output-effects.css';
import { createElement, RotateCcw } from 'lucide';
interface Host {
  value(): OutputEffects;
  change(value: OutputEffects): void;
  disabled?(): boolean;
  preview?(): { source: CanvasImageSource; document: ImageDocument } | undefined;
  error(error: unknown): void;
  settingsLayout?: boolean;
  resetContainer?: HTMLElement;
}
export function mountOutputEffects(root: HTMLElement, host: Host) {
  root.classList.add('output-effects');
  root.innerHTML = `<div class="output-effect-fields">
    <label>圆角<input data-effect="radius" type="number" min="0" max="2048" step="1" aria-label="圆角像素"></label>
    <label>边框<input data-effect="border-width" type="number" min="0" max="64" step="1" aria-label="边框宽度"></label>
    <label>边框颜色<input data-effect="border-color" type="color" aria-label="边框颜色"></label>
    <label class="output-shadow-switch">阴影<input data-effect="shadow-enabled" type="checkbox" aria-label="启用阴影"></label>
    <label data-shadow-field>模糊<input data-effect="shadow-blur" type="number" min="0" max="80" aria-label="阴影模糊像素"></label>
    <label data-shadow-field>水平偏移<input data-effect="shadow-x" type="number" min="-80" max="80" aria-label="阴影水平偏移"></label>
    <label data-shadow-field>垂直偏移<input data-effect="shadow-y" type="number" min="-80" max="80" aria-label="阴影垂直偏移"></label>
    <label data-shadow-field>不透明度<input data-effect="shadow-opacity" type="number" min="0" max="100" aria-label="阴影不透明度百分比"></label>
    <label data-shadow-field>阴影颜色<input data-effect="shadow-color" type="color" aria-label="阴影颜色"></label>
    </div><button type="button" class="quiet output-effect-reset">恢复原图效果</button>
    <div class="output-effect-preview" hidden><canvas aria-label="输出效果预览"></canvas><span class="output-effect-size"></span></div>`;
  const field = (name: string) => root.querySelector<HTMLInputElement>(`[data-effect="${name}"]`)!;
  const colors: ReturnType<typeof setupColorPicker>[] = [];
  const read = () =>
    outputEffects({
      radius: Number(field('radius').value),
      border: { width: Number(field('border-width').value), color: field('border-color').value },
      shadow: {
        enabled: field('shadow-enabled').checked,
        blur: Number(field('shadow-blur').value),
        x: Number(field('shadow-x').value),
        y: Number(field('shadow-y').value),
        opacity: Number(field('shadow-opacity').value) / 100,
        color: field('shadow-color').value,
      },
    });
  const change = (value: OutputEffects) => {
    if (host.disabled?.()) {
      refresh();
      return;
    }
    try {
      host.change(value);
      refresh();
    } catch (error) {
      host.error(error);
      refresh();
    }
  };
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-effect]'))
    input.onchange = () => {
      try {
        change(read());
      } catch (error) {
        host.error(error);
        refresh();
      }
    };
  const reset = root.querySelector<HTMLButtonElement>('.output-effect-reset')!;
  if (host.resetContainer) {
    reset.className = 'icon-button quiet output-effect-reset';
    reset.setAttribute('aria-label', '恢复原图效果');
    reset.title = '恢复原图效果';
    reset.replaceChildren(
      createElement(RotateCcw, { 'aria-hidden': 'true', 'stroke-width': 1.75 }),
    );
    host.resetContainer.append(reset);
  }
  reset.onclick = () => change(defaultEffects());
  function refresh(preview = true) {
    const v = host.value();
    const numbers = {
      radius: v.radius,
      'border-width': v.border.width,
      'shadow-blur': v.shadow.blur,
      'shadow-x': v.shadow.x,
      'shadow-y': v.shadow.y,
      'shadow-opacity': Math.round(v.shadow.opacity * 100),
    };
    for (const [name, value] of Object.entries(numbers)) field(name).value = String(value);
    field('border-color').value = v.border.color;
    field('shadow-color').value = v.shadow.color;
    field('shadow-enabled').checked = v.shadow.enabled;
    const disabled = !!host.disabled?.();
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-effect]'))
      input.disabled = disabled;
    for (const color of colors) color.refresh();
    for (const row of root.querySelectorAll<HTMLElement>('[data-shadow-field]'))
      row.hidden = !v.shadow.enabled;
    reset.disabled = disabled;
    if (preview && host.preview && !disabled) {
      const state = host.preview();
      const container = root.querySelector<HTMLElement>('.output-effect-preview')!;
      container.hidden = !state?.document.selection;
      if (state?.document.selection) {
        try {
          const r = state.document.selection,
            size = outputLayout(r.width, r.height, v);
          const scale = Math.min(
            1,
            (220 * devicePixelRatio) / size.width,
            (140 * devicePixelRatio) / size.height,
          );
          const image = captureOutput(state.source, state.document, scale),
            canvas = container.querySelector('canvas')!;
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.style.width = image.width / devicePixelRatio + 'px';
          canvas.style.height = image.height / devicePixelRatio + 'px';
          canvas.getContext('2d')!.drawImage(image, 0, 0);
          image.width = image.height = 0;
          container.querySelector('.output-effect-size')!.textContent =
            size.width + ' × ' + size.height + ' px';
        } catch (error) {
          host.error(error);
        }
      }
    }
  }
  if (host.settingsLayout) {
    for (const row of root.querySelectorAll('label')) row.classList.add('field');
    root.querySelector('.output-shadow-switch')!.classList.add('tool-check');
    for(const row of root.querySelectorAll('label'))row.classList.add('setting-row');
  }
  customControls(root);
  const identity = 'output-effect-' + crypto.randomUUID();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type=color]')) {
    input.id = identity + '-' + input.dataset.effect;
    colors.push(setupColorPicker(input));
  }
  refresh();
  return { refresh };
}
