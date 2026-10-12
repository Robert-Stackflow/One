import type { AudioTestState } from '../shared/recording/recording';
import { AudioLines, Square } from 'lucide';
import { icon, registerIcons } from './ui';
registerIcons({ 'audio-lines': AudioLines, square: Square });

/** A shared, silent level indicator; the owner supplies real endpoint samples. */
export function audioLevel(root: HTMLElement, label: string, toggle: (enabled: boolean) => void) {
  root.className = 'audio-test-control';
  root.innerHTML = `<div class="audio-test-row"><button type="button" class="quiet audio-test-button"></button><div class="audio-level" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="audio-level-fill"></span></div><span class="audio-level-value"></span></div><p class="audio-test-message" role="status" hidden></p>`;
  const button = root.querySelector<HTMLButtonElement>('button')!,
    meter = root.querySelector<HTMLElement>('[role=meter]')!,
    value = root.querySelector<HTMLElement>('.audio-level-value')!,
    message = root.querySelector<HTMLElement>('.audio-test-message')!;
  meter.setAttribute('aria-label', label + '音量');
  let active = false,
    starting = false,
    disabled = false;
  const updateButton = () => {
    const text = active ? '停止' : starting ? '取消' : '测试';
    if (button.dataset.action !== text) {
      button.dataset.action = text;
      button.innerHTML =
        icon(active || starting ? 'lucide:square' : 'lucide:audio-lines') + `<span>${text}</span>`;
    }
    button.setAttribute('aria-label', (active || starting ? '停止测试' : '测试') + label);
    button.setAttribute('aria-pressed', String(active || starting));
    button.disabled = disabled;
  };
  button.onclick = () => toggle(!(active || starting));
  const control = {
    get active() {
      return active || starting;
    },
    disable(next: boolean) {
      disabled = next;
      updateButton();
    },
    set(state: AudioTestState) {
      active = state.status === 'active';
      starting = state.status === 'starting';
      root.dataset.status = state.status;
      const level = Math.max(0, Math.min(1, state.level)),
        db = level > 0 ? Math.max(-60, 20 * Math.log10(level)) : -60;
      const percent = active && level > 0.001 ? Math.round(((db + 60) / 60) * 100) : 0;
      meter.style.setProperty('--audio-level', percent + '%');
      meter.setAttribute('aria-valuenow', String(percent));
      meter.setAttribute(
        'aria-valuetext',
        active ? (level > 0.001 ? `${Math.round(db)} dB` : '未检测到声音') : '未测试',
      );
      meter.dataset.loud = String(db > -6 && active);
      value.textContent = active
        ? level > 0.001
          ? `${Math.round(db)} dB`
          : '静音'
        : starting
          ? '准备中'
          : '未测试';
      message.textContent = state.message || '';
      message.hidden = !state.message;
      updateButton();
    },
  };
  control.set({ channel: 'system', status: 'idle', level: 0 });
  return control;
}
