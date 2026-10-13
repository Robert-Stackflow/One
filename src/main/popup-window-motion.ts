import { systemPreferences, type BrowserWindow } from 'electron';

export const popupWindowRoles = new Set(['tray-menu', 'search-menu', 'file-context', 'recording-toolbar-menu', 'native-tooltip']);

/** Native popups retain one Windows frame/shadow. Fade the whole window rather
 * than moving/scaling content inside an already visible native frame. */
export function bindPopupWindowMotion(
  window: BrowserWindow,
  reduced = () => {
    const settings = systemPreferences.getAnimationSettings();
    return settings.prefersReducedMotion || !settings.shouldRenderRichAnimation;
  },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const stop = () => { ++revision; clearTimeout(timer); timer = undefined; };
  const prepare = () => { stop(); if (!window.isDestroyed()) window.setOpacity(reduced() ? 1 : 0); };
  prepare();
  window.on('hide', prepare);
  window.on('closed', stop);
  window.on('show', () => {
    stop();
    if (reduced()) { window.setOpacity(1); return; }
    const current = revision, started = performance.now();
    const tick = () => {
      if (current !== revision || window.isDestroyed() || !window.isVisible()) return;
      const progress = Math.min(1, (performance.now() - started) / 180);
      window.setOpacity(1 - (1 - progress) ** 3);
      if (progress < 1) timer = setTimeout(tick, 16);
      else timer = undefined;
    };
    tick();
  });
}
