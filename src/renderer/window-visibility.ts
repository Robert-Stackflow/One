// Native visibility also covers prewarmed windows and minimization. Chromium's
// document.hidden can remain false when background throttling/focus emulation is disabled.
let visible = false;
let initialized = false;
const listeners = new Set<(visible: boolean) => void>();
export const isWindowVisible = () => visible;
export function onWindowVisibility(callback: (visible: boolean) => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
export function setupWindowVisibility() {
  if (initialized) return;
  initialized = true;
  let revision = 0;
  const update = (value: { visible: boolean }) => {
    if (visible === value.visible) return;
    visible = value.visible;
    for (const callback of listeners) callback(visible);
  };
  window.one.onWindowState(value => { revision++; update(value); });
  const request = revision;
  void window.one.windowState().then(value => { if (request === revision) update(value); }).catch(() => {});
}
