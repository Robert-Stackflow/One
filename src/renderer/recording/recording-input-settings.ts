import { customControls } from '../controls';
import {setupColorControls} from '../color-picker';
import { inputStyle, type InputStyle } from '../../shared/recording/recording-input';
/** The same property controls are used before capture and during replay. */
export function inputSettings(
  root: HTMLElement,
  prefix: string,
  initial: InputStyle,
  change: (value: InputStyle) => void,
  recorded?: InputStyle,
) {
  root.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'input-style-grid';
  root.append(grid);
  const heading = (title: string) => {
    const titleNode = document.createElement('h3');
    titleNode.className = 'property-section-title';
    titleNode.textContent = title;
    grid.append(titleNode);
  };
  let style = { ...initial };
  const update = (key: keyof InputStyle, value: string | boolean | number) => {
    style = inputStyle({
      ...style,
      ...(key === 'position' && value === 'custom'
        ? { x: style.x ?? 0.05, y: style.y ?? 0.85 }
        : {}),
      [key]: value,
    });
    change(style);
  };
  function select(key: keyof InputStyle, title: string, choices: [string, string][]) {
    const label = document.createElement('label'),
      field = document.createElement('select');
    label.textContent = title;
    field.id = prefix + '-' + key;
    field.setAttribute('aria-label', title);
    for (const [value, title] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = title;
      field.append(option);
    }
    field.value = String(style[key]);
    field.onchange = () => update(key, field.value);
    label.append(field);
    grid.append(label);
  }
  heading(recorded ? '回显内容' : '采集内容');
  select(
    'keys',
    '按键回显',
    recorded
      ? [
          ['off', '不显示'],
          ...(recorded.keys === 'off'
            ? []
            : [
                ['shortcuts', '仅快捷键'] as [string, string],
                ...(recorded.keys === 'all' ? [['all', '全部按键'] as [string, string]] : []),
              ]),
        ]
      : [
          ['off', '不记录'],
          ['shortcuts', '仅快捷键'],
          ['all', '全部按键'],
        ],
  );
  for (const [key, title] of [
    ['clicks', '鼠标点击与滚轮'],
    ['trail', '鼠标移动轨迹'],
  ] as const) {
    const label = document.createElement('label'),
      field = document.createElement('input');
    label.className = 'input-toggle';
    label.textContent = title;
    field.type = 'checkbox';
    field.id = prefix + '-' + key;
    field.checked = style[key];
    field.disabled = !!recorded && !recorded[key];
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
  heading('显示样式');
  select('position', '按键位置', [
    ['custom', '自由位置'],
    ['bottom-left', '左下'],
    ['bottom-center', '下方居中'],
    ['bottom-right', '右下'],
    ['top-left', '左上'],
    ['top-center', '上方居中'],
    ['top-right', '右上'],
  ]);
  for (const [key, title, min, max, step] of [
    ['size', '按键大小', 16, 96, 1],
    ['duration', '停留时间', 500, 5000, 100],
    ['animation', '动画速度', 0.5, 2, 0.1],
  ] as const) {
    const label = document.createElement('label'),
      row = document.createElement('div'),
      field = document.createElement('input'),
      value = document.createElement('output');
    label.textContent = title;
    row.className = 'input-range';
    field.type = 'range';
    field.id = prefix + '-' + key;
    field.min = String(min);
    field.max = String(max);
    field.step = String(step);
    field.value = String(style[key]);
    field.setAttribute('aria-label', title);
    const sync = () => {
      value.textContent =
        key === 'duration'
          ? (Number(field.value) / 1000).toFixed(1) + ' 秒'
          : field.value + (key === 'animation' ? '×' : ' px');
    };
    sync();
    field.oninput = () => {
      sync();
      update(key, Number(field.value));
    };
    row.append(field, value);
    label.append(row);
    grid.append(label);
  }
  const label = document.createElement('label'),
    color = document.createElement('input');
  label.textContent = '回显颜色';
  color.type = 'color';
  color.id = prefix + '-color';
  color.value = style.color;
  color.setAttribute('aria-label', '回显颜色');
  color.oninput = () => update('color', color.value);
  label.append(color);
  grid.append(label);
  customControls(root);
  setupColorControls(root);
}
