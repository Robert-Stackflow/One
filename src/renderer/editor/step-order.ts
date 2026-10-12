import type { AnnotationEditor } from './annotation-editor';
import './step-order.css';

/** Shared controls for screenshot, imported image and recording annotation surfaces. */
export function stepOrderControls(
  parent: HTMLElement,
  editor: () => AnnotationEditor | undefined,
  locked: () => boolean,
  visible: () => boolean = () => true,
) {
  const root = document.createElement('div');
  root.id = 'step-order';
  root.className = 'annotation-step-order';
  root.hidden = true;
  root.innerHTML = `<label>顺序<input id="step-position" type="number" min="1" step="1" aria-label="序号顺序" title="修改顺序会自动调整其他序号"><span id="step-count"></span></label><button id="step-earlier" type="button" title="提前一步 · Alt+←" aria-label="序号提前一步">提前</button><button id="step-later" type="button" title="延后一步 · Alt+→" aria-label="序号延后一步">延后</button>`;
  parent.append(root);
  const input = root.querySelector<HTMLInputElement>('input')!,
    count = root.querySelector<HTMLElement>('#step-count')!,
    earlier = root.querySelector<HTMLButtonElement>('#step-earlier')!,
    later = root.querySelector<HTMLButtonElement>('#step-later')!;
  const refresh = () => {
    const state = editor()?.stepOrder;
    root.hidden = !state || !visible();
    if (!state) return;
    if (document.activeElement !== input) input.value = String(state.position);
    input.max = String(state.count);
    input.disabled = locked();
    count.textContent = '/ ' + state.count;
    earlier.disabled = locked() || state.position === 1;
    later.disabled = locked() || state.position === state.count;
  };
  const move = (delta: number) => {
    const current = editor(),
      state = current?.stepOrder;
    if (!locked() && visible() && state) current!.orderStep(state.position + delta);
    refresh();
  };
  earlier.onclick = () => move(-1);
  later.onclick = () => move(1);
  input.onchange = () => {
    const current = editor();
    if (!locked() && visible() && input.validity.valid) current?.orderStep(input.valueAsNumber);
    input.value = String(current?.stepOrder?.position || 1);
    refresh();
  };
  return {
    refresh,
    keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
        (event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable="true"]')) ||
        locked() ||
        !visible() ||
        !editor()?.stepOrder
      )
        return false;
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
      return true;
    },
  };
}
