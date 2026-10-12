import { setupColorPicker } from '../color-picker';
import './annotation-properties.css';
import { annotationRanges } from './annotation-config';
import { textStyleControls } from './text-style-controls';

/** App-owned property controls retain the backing inputs used by the editor. */
export function captureProperties(
  root: HTMLElement,
  options: { colorMenu?: (anchor: HTMLElement) => void; ids?: Record<string, string> } = {},
) {
  root.classList.add('annotation-properties');
  const refreshText = textStyleControls(root, options.ids);
  const id = (name: string) => options.ids?.[name] || name;
  const color = root.querySelector<HTMLInputElement>('#' + id('mark-color'))!;
  const palette = root.querySelector<HTMLElement>('#' + id('mark-palette'))!;
  palette.classList.add('annotation-palette');
  color.closest('label, .capture-property')!.classList.add('annotation-color-field');
  for (const [field, kind] of [
    ['mark-width', 'width'],
    ['mark-size', 'size'],
  ])
    root
      .querySelector('#' + id(field))
      ?.closest('label')
      ?.classList.add('annotation-' + kind + '-field');
  const presets = [
    ['#e34e4e', '红色'],
    ['#f39b35', '橙色'],
    ['#f2cf40', '黄色'],
    ['#49a775', '绿色'],
    ['#369ee6', '蓝色'],
    ['#9b6cce', '紫色'],
    ['#202020', '黑色'],
    ['#ffffff', '白色'],
  ] as const;
  for (const [value, name] of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = value;
    button.title = button.ariaLabel = name + ' · ' + value.toUpperCase();
    button.style.setProperty('--preset-color', value);
    button.onclick = () => {
      color.value = value;
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
    };
    palette.append(button);
  }
  const picker = options.colorMenu
    ? (() => {
        const wrapper = document.createElement('span'),
          trigger = document.createElement('button'),
          swatch = document.createElement('span');
        wrapper.className = 'color-picker-control';
        trigger.className = 'color-picker-trigger';
        trigger.id = 'mark-color-trigger';
        trigger.type = 'button';
        trigger.ariaLabel = '自定义标注颜色';
        trigger.setAttribute('aria-haspopup', 'dialog');
        swatch.className = 'color-picker-swatch';
        trigger.append(swatch);
        color.before(wrapper);
        color.hidden = true;
        wrapper.append(color, trigger);
        trigger.onclick = () => options.colorMenu!(trigger);
        return {
          refresh: () => {
            trigger.disabled = color.disabled;
            trigger.style.setProperty('--picked-color', color.value);
          },
        };
      })()
    : setupColorPicker(color, {
        presets: presets.map(([value]) => value),
        eyedropper: true,
      });
  color.closest('.color-picker-control')!.classList.add('capture-color-control');
  document.getElementById(id('mark-color') + '-panel')?.classList.add('capture-color-panel');
  document.getElementById(id('mark-color') + '-trigger')!.title = options.colorMenu
    ? '自定义颜色 · 色板 / HEX / RGB'
    : '自定义颜色 · 色板 / HEX / RGB / 屏幕取色';
  const ranges: { input: HTMLInputElement; value: HTMLInputElement; choices: HTMLElement }[] = [];
  for (const [name, definition] of Object.entries(annotationRanges)) {
    const input = root.querySelector<HTMLInputElement>('#' + id(name));
    if (!input) continue;
    input.min = String(definition.min);
    input.max = String(definition.max);
    const control = document.createElement('span'),
      choices = document.createElement('span');
    control.className = 'capture-range-control';
    choices.className = 'capture-range-presets';
    input.before(control);
    control.append(choices, input);
    const valueWrap = document.createElement('span'),
      value = document.createElement('input'),
      unit = document.createElement('span');
    valueWrap.className = 'capture-range-value';
    value.type = 'number';
    value.dataset.customControl = 'true';
    value.min = input.min;
    value.max = input.max;
    value.step = input.step || '1';
    value.ariaLabel = input.ariaLabel + '数值';
    unit.textContent = definition.unit;
    valueWrap.append(value, unit);
    control.append(valueWrap);
    const apply = (next: number, preview: boolean) => {
      if (input.disabled || !Number.isFinite(next)) return;
      input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), next)));
      input.dispatchEvent(new Event(preview ? 'input' : 'change', { bubbles: true }));
      refresh();
    };
    value.oninput = () => {
      if (value.value && value.checkValidity()) apply(value.valueAsNumber, true);
    };
    value.onchange = () => apply(value.valueAsNumber, false);
    value.onblur = () => {
      value.value = input.value;
    };
    for (const preset of definition.presets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = String(preset);
      button.ariaLabel = button.title = input.ariaLabel + ' ' + preset + ' ' + definition.unit;
      if ('dots' in definition && definition.dots) {
        button.className = 'capture-size-preset';
        const dot = document.createElement('span');
        const size = Math.max(3, Math.min(14, name === 'mark-width' ? preset + 2 : preset / 4));
        dot.style.width = dot.style.height = size + 'px';
        button.append(dot);
      } else button.textContent = String(preset);
      button.onclick = () => {
        apply(preset, true);
        apply(preset, false);
      };
      choices.append(button);
    }
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    ranges.push({ input, value, choices });
  }
  function refresh() {
    picker.refresh();
    for (const button of palette.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = color.disabled;
      button.setAttribute('aria-pressed', String(button.dataset.color === color.value));
    }
    for (const { input, value, choices } of ranges) {
      const percent =
        ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
      input.style.setProperty('--range-progress', percent + '%');
      if (document.activeElement !== value) value.value = input.value;
      value.disabled = input.disabled;
      for (const button of choices.querySelectorAll<HTMLButtonElement>('button')) {
        button.disabled = input.disabled;
        button.setAttribute('aria-pressed', String(button.dataset.value === input.value));
      }
    }
    // Flex order differs from DOM order (brush size comes first). Separators
    // belong between visual neighbours, never at the start of a wrapped row.
    const edge = parseFloat(getComputedStyle(root).paddingLeft) + 1;
    const left = root.getBoundingClientRect().left;
    for (const field of [...root.children] as HTMLElement[]) {
      if (!field.hidden)
        field.classList.toggle(
          'property-row-start',
          field.getBoundingClientRect().left - left <= edge,
        );
    }
  }
  color.addEventListener('input', refresh);
  color.addEventListener('change', refresh);
  refresh();
  return {
    refresh: () => {
      refresh();
      refreshText();
    },
  };
}
