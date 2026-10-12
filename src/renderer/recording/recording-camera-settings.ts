import { customControls } from '../controls';
import {setupColorControls} from '../color-picker';
import { cameraStyle, type CameraStyle } from '../../shared/recording/recording-camera';
/** Shared camera appearance controls for setup and editable replay. */
export function cameraSettings(
  root: HTMLElement,
  prefix: string,
  initial: CameraStyle,
  change: (value: CameraStyle) => void,
  compact = false,
) {
  root.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'input-style-grid';
  grid.classList.toggle('compact-camera', compact);
  root.append(grid);
  const heading = (title: string) => {
    const titleNode = document.createElement('h3');
    titleNode.className = 'property-section-title';
    titleNode.textContent = title;
    grid.append(titleNode);
  };
  let style = { ...initial };
  const update = (key: keyof CameraStyle, value: unknown) => {
    style = cameraStyle({ ...style, [key]: value });
    change(style);
  };
  heading('画面外观');
  for (const [key, title] of [
    ['visible', '显示画中画'],
    ['mirror', '镜像画面'],
    ['shadow', '窗口阴影'],
  ] as const) {
    const label = document.createElement('label'),
      field = document.createElement('input');
    label.className = 'input-toggle';
    label.textContent = title;
    field.type = 'checkbox';
    field.id = prefix + '-' + key;
    field.checked = style[key];
    field.onchange = () => update(key, field.checked);
    const toggle = document.createElement('span'),
      track = document.createElement('span');
    toggle.className = 'switch';
    track.className = 'switch-track';
    field.setAttribute('role', 'switch');
    toggle.append(field, track);
    label.append(toggle);
    grid.append(label);
  }
  const label = document.createElement('label'),
    select = document.createElement('select');
  label.textContent = '画面形状';
  select.id = prefix + '-shape';
  for (const [value, title] of [
    ['rectangle', '矩形'],
    ['rounded', '圆角'],
    ['circle', '圆形'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    select.append(option);
  }
  select.value = style.shape;
  select.onchange = () => update('shape', select.value);
  label.append(select);
  grid.append(label);
  heading('尺寸与位置');
  for (const [key, title, min, max, step, multiplier] of [
    ['width', '画面宽度', 10, 60, 1, 100],
    ['x', '水平位置', 0, 100, 1, 100],
    ['y', '垂直位置', 0, 100, 1, 100],
    ['opacity', '不透明度', 10, 100, 1, 100],
    ['border', '边框宽度', 0, 8, 1, 1],
  ] as const) {
    if (compact && (key === 'x' || key === 'y')) continue;
    if (key === 'opacity') heading('边框与透明度');
    const label = document.createElement('label'),
      field = document.createElement('input'),
      output = document.createElement('output');
    label.textContent = title;
    field.type = 'range';
    field.setAttribute('aria-label', title);
    field.id = prefix + '-' + key;
    field.min = String(min);
    field.max = String(max);
    field.step = String(step);
    field.value = String(style[key] * multiplier);
    const text = () => (output.textContent = field.value + (multiplier === 100 ? '%' : ' px'));
    text();
    field.oninput = () => {
      text();
      update(key, Number(field.value) / multiplier);
    };
    const row = document.createElement('div');
    row.className = 'input-range';
    row.append(field, output);
    label.append(row);
    grid.append(label);
  }
  const colorLabel = document.createElement('label'),
    color = document.createElement('input');
  colorLabel.textContent = '边框颜色';
  color.type = 'color';
  color.id = prefix + '-color';
  color.value = style.color;
  color.setAttribute('aria-label', '边框颜色');
  color.maxLength = 7;
  color.oninput = () => {
    if (/^#[\da-f]{6}$/i.test(color.value)) update('color', color.value);
  };
  color.onblur = () => {
    color.value = style.color;
  };
  colorLabel.append(color);
  grid.append(colorLabel);
  customControls(root);
  setupColorControls(root);
}
