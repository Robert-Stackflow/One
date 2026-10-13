import './recording-region-overlay.css';
import { createElement, Move } from 'lucide';
import type { RecordingRegionState } from '../../shared/recording/recording-region';
const api = window.one?.recordingRegion;
if (api) {
  document.getElementById('frame')!.hidden = true;
  const button = document.getElementById('drag') as HTMLButtonElement;
  button.hidden = false;
  document
    .getElementById('icon')!
    .replaceChildren(createElement(Move, { 'aria-hidden': 'true', 'stroke-width': 1.6 }));
  let state: RecordingRegionState | undefined;
  const refresh = async () => {
    try {
      state = await api.state();
      document.getElementById('size')!.textContent =
        `${state.crop.width} × ${state.crop.height} px`;
    } catch {
      button.disabled = true;
    }
  };
  api.onChange(() => void refresh());
  void refresh();
  type Drag = { token: string; phase: 'start' | 'move' | 'end'; point: { x: number; y: number } };
  let active: { pointer: number; token: string } | undefined,
    pending: Drag | undefined,
    sending = false,
    lastPoint = { x: 0, y: 0 };
  const flush = async () => {
    if (sending) return;
    sending = true;
    try {
      while (pending) {
        if (pending.phase === 'move') await new Promise((resolve) => setTimeout(resolve, 25));
        const next = pending;
        pending = undefined;
        await api.drag(next.token, next.phase, next.point);
      }
    } catch (error) {
      pending = undefined;
      if (active && button.hasPointerCapture(active.pointer))
        button.releasePointerCapture(active.pointer);
      active = undefined;
      button.dataset.active = 'false';
      button.ariaDescription = String((error as Error).message).replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      );
    } finally {
      sending = false;
    }
  };
  button.onpointerdown = (event) => {
    if (event.button !== 0 || !state?.enabled || sending) return;
    event.preventDefault();
    active = { pointer: event.pointerId, token: state.token };
    lastPoint = { x: event.screenX, y: event.screenY };
    button.setPointerCapture(event.pointerId);
    button.dataset.active = 'true';
    pending = { token: state.token, phase: 'start', point: { x: event.screenX, y: event.screenY } };
    void flush();
  };
  button.onpointermove = (event) => {
    if (active?.pointer !== event.pointerId) return;
    lastPoint = { x: event.screenX, y: event.screenY };
    pending = { token: active.token, phase: 'move', point: { x: event.screenX, y: event.screenY } };
    void flush();
  };
  const end = (event: PointerEvent) => {
    if (active?.pointer !== event.pointerId) return;
    const point = event.type === 'pointerup' ? { x: event.screenX, y: event.screenY } : lastPoint;
    pending = { token: active.token, phase: 'end', point };
    active = undefined;
    button.dataset.active = 'false';
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    void flush();
  };
  button.onpointerup = end;
  button.onpointercancel = end;
  button.onlostpointercapture = end;
}
