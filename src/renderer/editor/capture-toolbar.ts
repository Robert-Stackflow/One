import { closeControls } from '../controls';
import { closeCaptureMenu } from './capture-menu';

/** Keep a user placement through tool/selection changes; reset explicitly. */
export function movableCaptureToolbar(
  panel: HTMLElement,
  handle: HTMLButtonElement,
  changed: () => void,
) {
  let position: { x: number; y: number } | undefined;
  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
  const clamp = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, innerWidth - panel.offsetWidth - 8)),
    y: Math.max(8, Math.min(y, innerHeight - panel.offsetHeight - 8)),
  });
  const reset = () => {
    position = undefined;
    changed();
  };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || handle.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    closeControls();
    closeCaptureMenu();
    for (const animation of panel.getAnimations())
      if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
    const bounds = panel.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: bounds.left, top: bounds.top };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    e.stopPropagation();
    position = clamp(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y);
    changed();
  });
  const stop = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    e.stopPropagation();
    drag = undefined;
    panel.classList.remove('is-dragging');
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    reset();
  });
  handle.addEventListener('keydown', (e) => {
    if (['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      reset();
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const bounds = panel.getBoundingClientRect(),
        amount = e.shiftKey ? 24 : 8;
      position = clamp(
        bounds.left + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0),
        bounds.top + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0),
      );
      changed();
    }
  });
  return {
    place(x: number, y: number) {
      if (position) position = clamp(position.x, position.y);
      return position || clamp(x, y);
    },
  };
}
