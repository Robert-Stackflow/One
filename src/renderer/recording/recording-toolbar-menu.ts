import './recording-toolbar-menu.css';
import { createElement, Check, Trash2, RotateCcw, Undo2, Redo2 } from 'lucide';
import { defaultAnnotationStyle, type AnnotationCommand } from '../../shared/recording/recording-annotations';
import { imageTools } from '../editor/annotation-tools';
import { strokeStyles, strokeDash } from '../../shared/capture/stroke-style';
import { setupColorPicker } from '../color-picker';
import { cameraSettings } from './recording-camera-settings';
import { defaultCameraStyle } from '../../shared/recording/recording-camera';
import { defaultInputStyle, type InputStyle } from '../../shared/recording/recording-input';
import { customControls } from '../controls';
const api = window.one!.recordingToolbar!,
  root = document.getElementById('menu')!,
  error = document.getElementById('error')!;
let token = '',
  style = defaultAnnotationStyle(),
  pending: (() => Promise<void>) | undefined,
  sending: Promise<void> | undefined,
  commitColor: (() => void) | undefined;
function failed(e: unknown) {
  error.hidden = false;
  error.textContent = (e as Error).message;
}
let fitting = false;
function fitContent() {
  if (!token || fitting) return;
  fitting = true;
  requestAnimationFrame(() => {
    fitting = false;
    const bottom = Math.max(
      ...[
        root,
        document.querySelector<HTMLElement>('.inline-color-picker'),
        error.hidden ? null : error,
      ]
        .filter((element): element is HTMLElement => !!element)
        .map((element) => element.getBoundingClientRect().bottom),
    );
    void api.fitMenu(token, Math.ceil(bottom + 8)).catch(failed);
  });
}
new ResizeObserver(fitContent).observe(root);
async function mutate(action: () => Promise<void>, close = false) {
  pending = action;
  if (!sending)
    sending = (async () => {
      try {
        while (pending) {
          const current = pending;
          pending = undefined;
          await current();
        }
      } finally {
        sending = undefined;
      }
    })();
  try {
    await sending;
    if (close) await api.closeMenu(token);
  } catch (e) {
    failed(e);
  }
}
function send(command: AnnotationCommand, close = true) {
  return mutate(() => api.annotate(token, command), close);
}
async function dismiss() {
  commitColor?.();
  try {
    await sending;
    await api.closeMenu(token);
  } catch (e) {
    failed(e);
  }
}
api.onDismissMenu(() => void dismiss());
function item(
  label: string,
  checked: boolean,
  choose: () => void,
  glyph?: Parameters<typeof createElement>[0],
) {
  const button = document.createElement('button');
  button.className = 'menu-item';
  button.type = 'button';
  button.role = 'menuitemradio';
  button.setAttribute('aria-checked', String(checked));
  if (glyph) button.append(createElement(glyph, { 'aria-hidden': 'true' }));
  const caption = document.createElement('span');
  caption.textContent = label;
  button.append(caption);
  if (checked) button.append(createElement(Check, { class: 'check', 'aria-hidden': 'true' }));
  button.onclick = choose;
  root.append(button);
  return button;
}
async function init() {
  const value = await api.menuState();
  token = value.state.token;
  style = value.state.annotationStyle || style;
  const menu = value.menu;
  if (menu.kind === 'camera' || menu.kind === 'input') {
    root.role = 'dialog';
    root.classList.add('settings-menu');
    const heading = document.createElement('header'),
      title = document.createElement('strong'),
      content = document.createElement('section'),
      hint = document.createElement('small');
    title.textContent = menu.kind === 'camera' ? '摄像头画面' : '键鼠记录';
    heading.append(title);
    root.append(heading, content, hint);
    root.setAttribute('aria-label', title.textContent);
    if (menu.kind === 'camera') {
      let camera =
        value.state.cameraStyle || value.state.options?.camera?.style || defaultCameraStyle();
      const render = () =>
        cameraSettings(
          content,
          'live-camera',
          camera,
          (style) => {
            camera = style;
            void mutate(() => api.cameraStyle(token, style));
          },
          true,
        );
      render();
      const reset = document.createElement('button');
      reset.id = 'camera-reset';
      reset.className = 'settings-reset';
      reset.title = '恢复画面布局';
      reset.setAttribute('aria-label', reset.title);
      reset.append(createElement(RotateCcw));
      reset.onclick = () => {
        camera = defaultCameraStyle();
        render();
        const style = { ...camera };
        void mutate(() => api.cameraStyle(token, style));
      };
      heading.append(reset);
      hint.textContent = '拖动画面移动，拖动右下角缩放。隐藏画面时仍保留摄像头轨道。';
    } else {
      let style = value.state.inputStyle || defaultInputStyle();
      content.className = 'input-style-grid';
      const keys = document.createElement('select'),
        label = document.createElement('label');
      label.textContent = '记录键盘操作';
      keys.id = 'live-input-keys';
      for (const [v, text] of [
        ['off', '关闭'],
        ['shortcuts', '仅快捷键'],
        ['all', '全部按键'],
      ]) {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = text;
        keys.append(option);
      }
      keys.value = style.keys;
      const update = (patch: Partial<InputStyle>) => {
        style = { ...style, ...patch };
        const current = { ...style };
        void mutate(() => api.inputStyle(token, current));
      };
      keys.onchange = () => update({ keys: keys.value as InputStyle['keys'] });
      label.append(keys);
      content.append(label);
      for (const [key, text] of [
        ['clicks', '记录鼠标点击与滚轮'],
        ['trail', '记录鼠标移动轨迹'],
      ] as const) {
        const row = document.createElement('label'),
          field = document.createElement('input');
        row.className = 'input-toggle';
        row.textContent = text;
        field.id = 'live-input-' + key;
        field.type = 'checkbox';
        field.checked = style[key];
        field.onchange = () => update({ [key]: field.checked });
        row.append(field);
        content.append(row);
      }
      customControls(content);
      hint.textContent = '开关立即生效，仅记录当前录制范围内的操作。暂停期间不记录。';
    }
  }
  if (menu.kind === 'tools')
    for (const tool of menu.tools!) {
      const [, label, glyph] = imageTools.find((t) => t[0] === tool)!;
      item(
        label,
        tool === menu.selected,
        () => void send({ kind: 'tool', tool }),
        glyph,
      ).dataset.tool = tool;
    }
  if (menu.kind === 'more') {
    for (const tool of menu.tools || []) {
      const [, label, glyph] = imageTools.find((entry) => entry[0] === tool)!;
      const button = item(
        label,
        menu.selected === tool,
        () => void send({ kind: 'tool', tool }),
        glyph,
      );
      button.dataset.tool = tool;
    }
    item('撤销标注', false, () => void send({ kind: 'undo' }), Undo2);
    item('重做标注', false, () => void send({ kind: 'redo' }), Redo2);
    item('清空标注', false, () => void send({ kind: 'clear' }), Trash2);
    const hint = document.createElement('small');
    hint.textContent = 'Ctrl+Z 撤销 · Ctrl+Y 重做';
    hint.style.cssText = 'padding:8px;color:var(--muted)';
    root.append(hint);
  }
  if (menu.kind === 'color') {
    const input = document.createElement('input');
    input.id = 'menu-color';
    input.type = 'color';
    input.value = style.color;
    root.append(input);
    commitColor = setupColorPicker(input, { eyedropper: false, inline: true }).commit;
    new ResizeObserver(fitContent).observe(document.querySelector('.inline-color-picker')!);
    input.onchange = () => {
      style = { ...style, color: input.value };
      void send({ kind: 'style', style }, false);
    };
  }
  if (menu.kind === 'stroke')
    for (const entry of strokeStyles) {
      const button = item(
        entry.label,
        entry.value === style.strokeStyle,
        () => void send({ kind: 'style', style: { ...style, strokeStyle: entry.value } }),
      );
      button.dataset.stroke = entry.value;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
        path = document.createElementNS(svg.namespaceURI, 'path');
      svg.setAttribute('viewBox', '0 0 32 20');
      svg.classList.add('pattern');
      path.setAttribute(
        'd',
        entry.value === 'double'
          ? 'M2 7h28M2 13h28'
          : entry.value === 'wavy'
            ? 'M2 10q3-8 6 0t6 0t6 0t6 0t4 0'
            : 'M2 10h28',
      );
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-dasharray', strokeDash(entry.value, 1.5).join(' ') || 'none');
      path.setAttribute('stroke-linecap', 'round');
      svg.append(path);
      button.prepend(svg);
    }
  if (menu.kind === 'font')
    for (const font of ['Segoe UI', 'Microsoft YaHei', 'Arial', 'Consolas']) {
      const button = item(
        font,
        font === style.fontFamily,
        () => void send({ kind: 'style', style: { ...style, fontFamily: font } }),
      );
      button.style.fontFamily = font;
    }
  if (menu.kind === 'weight')
    for (const [weight, label] of [
      [400, '常规'],
      [600, '半粗'],
      [700, '粗体'],
    ] as const)
      item(
        label,
        weight === style.fontWeight,
        () => void send({ kind: 'style', style: { ...style, fontWeight: weight } }),
      );
  root
    .querySelector<HTMLElement>('[aria-checked=true],button,[tabindex="0"]')
    ?.focus({ preventScroll: true });
  fitContent();
}
document.onkeydown = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    void dismiss();
    return;
  }
  if (root.role === 'dialog' || e.target instanceof HTMLInputElement) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')],
    i = buttons.indexOf(document.activeElement as HTMLButtonElement),
    next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
};
void init().catch(failed);
