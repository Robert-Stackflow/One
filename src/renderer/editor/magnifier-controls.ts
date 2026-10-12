import type { AnnotationEditor } from './annotation-editor';
import type { Annotation, ImageDocument } from '../../shared/capture/image-document';
import { magnifierBounds } from '../../shared/capture/magnifier';
import './magnifier-controls.css';

export function magnifierControls(
  parent: HTMLElement,
  options: {
    editor(): AnnotationEditor | undefined;
    scene(): ImageDocument | undefined;
    locked(): boolean;
    moveTool(mark: Annotation): void;
  },
) {
  const root = document.createElement('div');
  root.id = 'magnifier-controls';
  root.className = 'magnifier-controls';
  root.hidden = true;
  const parts = document.createElement('div');
  parts.className = 'magnifier-parts';
  for (const [part, label] of [
    ['target', '显示区'],
    ['source', '取样区'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.magnifierPart = part;
    button.onclick = () => {
      const state = current();
      if (!state || options.locked()) return;
      options.moveTool(state.mark);
      state.editor.magnifierPart = part;
      state.editor.select(state.mark);
      refresh();
    };
    parts.append(button);
  }
  root.append(parts);
  const fields = document.createElement('div');
  fields.className = 'magnifier-fields';
  const inputs = new Map<'x' | 'y' | 'width' | 'height', HTMLInputElement>();
  for (const [key, label] of [
    ['x', 'X'],
    ['y', 'Y'],
    ['width', '宽'],
    ['height', '高'],
  ] as const) {
    const item = document.createElement('label'),
      title = document.createElement('span'),
      input = document.createElement('input');
    title.textContent = label;
    input.id = 'magnifier-' + key;
    input.type = 'number';
    input.step = 'any';
    input.min = key === 'width' || key === 'height' ? '0.5' : '-1000000';
    input.max = '1000000';
    input.dataset.customControl = 'magnifier';
    input.ariaLabel = '放大镜当前区域' + label;
    input.onchange = () => {
      const state = current();
      if (!state) return;
      const value = input.valueAsNumber;
      if (!options.locked() && input.validity.valid && Number.isFinite(value))
        state.editor.magnifierRegion({
          ...magnifierBounds(state.mark, state.doc, state.editor.magnifierPart),
          [key]: value,
        });
      input.blur();
      refresh();
    };
    inputs.set(key, input);
    item.append(title, input);
    fields.append(item);
  }
  const hint = document.createElement('p');
  hint.className = 'magnifier-hint';
  hint.textContent = '可拖动当前区域。取样区越小，放大越大；移动显示区保留取样内容。';
  root.title = hint.textContent;
  root.append(fields, hint);
  parent.append(root);
  function current() {
    const editor = options.editor(),
      doc = options.scene(),
      mark = doc?.annotations.find((a) => a.id === editor?.selectedId && a.tool === 'magnify');
    return editor && doc && mark ? { editor, doc, mark } : undefined;
  }
  function refresh() {
    const state = current();
    root.hidden = !state;
    if (!state) return;
    const rect = magnifierBounds(state.mark, state.doc, state.editor.magnifierPart);
    for (const [key, input] of inputs) {
      if (key === 'width' || key === 'height')
        input.min = state.editor.magnifierPart === 'source' ? '0.5' : '1';
      if (document.activeElement !== input)
        input.value = String(Math.round(rect[key] * 1000) / 1000);
      input.disabled = options.locked();
    }
    for (const button of parts.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = options.locked();
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.magnifierPart === state.editor.magnifierPart),
      );
    }
  }
  return { refresh };
}
