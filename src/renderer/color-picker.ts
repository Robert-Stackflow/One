import { t as tr } from '../shared/capture/i18n';
import {colorHSV as hsv,hsvColor as hex} from '../shared/colors';
import { openAnchoredPopover, closeAnchoredPopover } from './anchored-popover';
import { onRemoval } from './dom-lifecycle';
import {icon} from './icons';
import {openControl,releaseControl} from './controls';
interface ColorControl {
  refresh(): void;
  commit(): void;
  dispose(): void;
  panel: HTMLElement;
}
const controls = new WeakMap<HTMLInputElement, ColorControl>();
const roots=new WeakMap<HTMLElement,{refresh():void;dispose():void}>();
/** Observe only the feature container that owns these inputs, including later insertions. */
export function setupColorControls(root:HTMLElement){
  const existing=roots.get(root);if(existing)return existing;
  const owned=new Map<HTMLInputElement,ColorControl>();let disposed=false;
  const refresh=()=>{
    if(disposed)return;
    const inputs=[...(root.matches('input[type=color]')?[root as HTMLInputElement]:[]),...root.querySelectorAll<HTMLInputElement>('input[type=color]')];
    for(const [input,control] of owned)if(!root.contains(input)){control.dispose();owned.delete(input);}
    for(const input of inputs)if(!controls.has(input))owned.set(input,setupColorPicker(input));
  };
  const observer=new MutationObserver(refresh);
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['type']});
  const dispose=()=>{if(disposed)return;disposed=true;observer.disconnect();release();for(const control of owned.values())control.dispose();owned.clear();roots.delete(root);};
  const release=onRemoval(root,dispose),controller={refresh,dispose};roots.set(root,controller);refresh();return controller;
}
/** An app-owned color panel; the backing input remains the editor's color value. */
export function setupColorPicker(
  input: HTMLInputElement,
  options: { presets?: readonly string[]; eyedropper?: boolean; inline?: boolean } = {},
) {
  const existing = controls.get(input);
  if (existing) return existing;
  if(input.type!=='color')throw Error('颜色控件需要 color 输入框');
  if(options.presets?.some(color=>!/^#[\da-f]{6}$/i.test(color)))throw Error('颜色预设无效');
  const originallyHidden=input.hidden;
  if (!input.id) input.id = 'color-' + crypto.randomUUID();
  const name =
    input.getAttribute('aria-label') || input.labels?.[0]?.textContent?.trim() || tr('颜色');
  const wrapper = document.createElement('span');
  wrapper.className = 'color-picker-control';
  input.before(wrapper);
  wrapper.append(input);
  input.hidden = true;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'color-picker-trigger';
  trigger.id = input.id + '-trigger';
  trigger.setAttribute('aria-label', tr('选择颜色') + ' · ' + name);
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML =
    '<span class="color-picker-swatch" aria-hidden="true"></span><span class="color-picker-value"></span>';
  wrapper.append(trigger);
  const panel = document.createElement('div');
  panel.className = 'color-picker-panel';
  panel.id = input.id + '-panel';
  panel.popover = 'manual';
  panel.role = 'dialog';
  panel.setAttribute('aria-label', tr('选择颜色'));
  panel.innerHTML = `<div class="color-picker-plane" tabindex="0" role="slider" aria-label="${tr('色彩')}" aria-valuemin="0" aria-valuemax="100"><span class="color-picker-marker"></span></div><input class="color-picker-hue" type="range" min="0" max="359" aria-label="${tr('色调')}"><div class="color-picker-presets"></div><label class="color-picker-hex"><span>HEX</span><input maxlength="7" spellcheck="false" aria-label="${tr('十六进制颜色')}"></label>`;
  const dialog = input.closest('dialog');
  if(options.inline)wrapper.after(panel);else (dialog || document.body).append(panel);
  trigger.setAttribute('aria-controls', panel.id);
  const plane = panel.querySelector<HTMLElement>('.color-picker-plane')!,
    hue = panel.querySelector<HTMLInputElement>('.color-picker-hue')!,
    field = panel.querySelector<HTMLInputElement>('.color-picker-hex input')!,
    presets = panel.querySelector<HTMLElement>('.color-picker-presets')!;
  let value = hsv(input.value),
    open = false,
    pointer: number | undefined,
    pending = false,
    writing = false,
    disposed = false;
  const rgb = document.createElement('div');
  rgb.className = 'color-picker-rgb';
  for (const name of ['R', 'G', 'B']) {
    const label = document.createElement('label'),
      channel = document.createElement('input');
    label.append(document.createTextNode(name));
    channel.type = 'number';
    channel.dataset.customControl = 'true';
    channel.min = '0';
    channel.max = '255';
    channel.step = '1';
    channel.ariaLabel = 'RGB ' + name;
    label.append(channel);
    rgb.append(label);
    channel.onchange = () => {
      const channels = [...rgb.querySelectorAll<HTMLInputElement>('input')];
      if (channels.some((c) => !c.value || !c.checkValidity())) {
        sync();
        return;
      }
      value = hsv(
        '#' + channels.map((c) => c.valueAsNumber.toString(16).padStart(2, '0')).join(''),
      );
      apply();
    };
  }
  panel.append(rgb);
  const sync = () => {
    const color = input.value.toUpperCase();
    trigger.style.setProperty('--picked-color', color);
    trigger.querySelector('.color-picker-value')!.textContent = color;
    panel.style.setProperty('--picked-hue', hex(value.h, 1, 1));
    plane.style.setProperty('--picked-x', value.s * 100 + '%');
    plane.style.setProperty('--picked-y', (1 - value.v) * 100 + '%');
    plane.setAttribute('aria-valuenow', String(Math.round(value.s * 100)));
    plane.setAttribute('aria-valuetext', color);
    hue.value = String(value.h);
    if (document.activeElement !== field) field.value = color;
    rgb.querySelectorAll<HTMLInputElement>('input').forEach((channel, i) => {
      if (document.activeElement !== channel)
        channel.value = String(parseInt(color.slice(1 + i * 2, 3 + i * 2), 16));
    });
    for (const button of presets.querySelectorAll<HTMLButtonElement>('button'))
      button.setAttribute('aria-pressed', String(button.dataset.color === input.value));
  };
  const apply = (preview = false) => {
    if(disposed)return;
    writing = true;
    try {
      input.value = hex(value.h, value.s, value.v);
      pending = preview;
      sync();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (!preview) input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      writing = false;
    }
  };
  for (const color of options.presets || [
    '#de4747',
    '#e89a38',
    '#e2c645',
    '#5eaa71',
    '#4c95d8',
    '#9b72cf',
    '#ffffff',
    '#202020',
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = color.toLowerCase();
    button.style.setProperty('--preset-color', color);
    button.setAttribute('aria-label', color);
    button.onclick = () => {
      value = hsv(color);
      apply();
    };
    presets.append(button);
  }
  const pick = (event: PointerEvent) => {
    const rect = plane.getBoundingClientRect();
    value.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    value.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    apply(true);
  };
  plane.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    plane.focus();
    pointer = event.pointerId;
    plane.setPointerCapture(pointer);
    pick(event);
  };
  plane.onpointermove = (event) => {
    if (event.pointerId === pointer) pick(event);
  };
  plane.onpointerup = plane.onpointercancel = (event) => {
    if(event.pointerId!==pointer)return;
    if (plane.hasPointerCapture(event.pointerId)) plane.releasePointerCapture(event.pointerId);
    pointer = undefined;
    if (pending) apply();
  };
  plane.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.02;
    value.s = Math.max(
      0,
      Math.min(
        1,
        value.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      ),
    );
    value.v = Math.max(
      0,
      Math.min(
        1,
        value.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
      ),
    );
    apply();
  };
  hue.oninput = () => {
    value.h = Number(hue.value);
    apply(true);
  };
  hue.onchange = () => {
    if (pending) apply();
  };
  field.oninput = () => {
    const color = field.value.startsWith('#') ? field.value : '#' + field.value;
    if (/^#[\da-f]{6}$/i.test(color)) {
      value = hsv(color);
      apply(true);
    }
  };
  field.onchange = field.onblur = () => {
    if (pending) apply();
    field.value = input.value.toUpperCase();
  };
  const close = (restore = false) => {
    if (!open) return;
    if (pending) apply();
    open = false;
    releaseControl(dismiss);
    void closeAnchoredPopover(panel);
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (restore) trigger.focus();
  };
  const dismiss = () => close();
  const outside = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
  };
  trigger.onclick = () => {
    if(disposed||input.matches(':disabled')||options.inline)return;
    if (open) {
      close();
      return;
    }
    openControl(dismiss);
    value = hsv(input.value);
    sync();
    open = true;
    if(!openAnchoredPopover(trigger,panel,{width:260,maxHeight:440,onDetach:()=>close()})){close();return;}
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    plane.focus({ preventScroll: true });
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (options.inline) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      const controls = Array.from(
          panel.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]'),
        ),
        first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  const dialogClosed = () => close();
  dialog?.addEventListener('close', dialogClosed);
  let picking: AbortController | undefined;
  const EyeDropper = (
    window as unknown as {
      EyeDropper?: new () => {
        open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }>;
      };
    }
  ).EyeDropper;
  if (options.eyedropper && EyeDropper) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-picker-eyedropper';
    button.innerHTML =
      icon('color') +
      `<span>${tr('屏幕取色')}</span>`;
    panel.append(button);
    button.onclick = async () => {
      if (picking||disposed||input.matches(':disabled')) return;
      close();
      const controller = new AbortController();
      picking = controller;
      try {
        const result = await new EyeDropper().open({ signal: controller.signal });
        if (
          wrapper.isConnected && !disposed && !input.matches(':disabled') &&
          !controller.signal.aborted &&
          /^#[\da-f]{6}$/i.test(result.sRGBHex)
        ) {
          value = hsv(result.sRGBHex);
          apply();
          trigger.focus({ preventScroll: true });
        }
      } catch (error) {
        if (!controller.signal.aborted && (error as Error).name !== 'AbortError')
          input.dispatchEvent(new CustomEvent('one:color-picker-error', { detail: error }));
      } finally {
        if (picking === controller) picking = undefined;
      }
    };
  }
  const cancelPicking = () => {
    picking?.abort();
    picking = undefined;
  };
  dialog?.addEventListener('close', cancelPicking);
  const refresh = () => {
    if (writing||disposed) return;
    if(input.type!=='color'){dispose();return;}
    value = hsv(input.value);
    trigger.disabled = input.matches(':disabled');
    panel.inert=trigger.disabled;
    if (trigger.disabled) {close();cancelPicking();}
    sync();
  };
  // Keep swatch, HEX and RGB in sync when owners restore defaults or change theme.
  const ownValue = Object.getOwnPropertyDescriptor(input, 'value'),
    nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => nativeValue.get!.call(input),
    set: (next) => {
      nativeValue.set!.call(input, next);
      refresh();
    },
  });
  const activate = (event: MouseEvent) => {
    event.preventDefault();
    if (!input.disabled) trigger.click();
  };
  input.addEventListener('click', activate);
  input.addEventListener('change', refresh);
  const form=input.form,reset=()=>queueMicrotask(refresh);form?.addEventListener('reset',reset);
  const observer = new MutationObserver(refresh);
  observer.observe(input, { attributes: true, attributeFilter: ['disabled','type'] });
  const fieldset=input.closest('fieldset');if(fieldset)observer.observe(fieldset,{attributes:true,attributeFilter:['disabled']});
  const dispose=() => {
    if(disposed)return;disposed=true;pending=false;
    release();
    observer.disconnect();
    input.removeEventListener('change', refresh);
    input.removeEventListener('click', activate);
    form?.removeEventListener('reset',reset);
    if (ownValue) Object.defineProperty(input, 'value', ownValue);
    else delete (input as unknown as { value?: string }).value;
    controls.delete(input);
    cancelPicking();
    close();
    void closeAnchoredPopover(panel,{immediate:true});
    panel.remove();
    dialog?.removeEventListener('close', dialogClosed);
    dialog?.removeEventListener('close', cancelPicking);
    input.hidden=originallyHidden;
    if(input.parentNode===wrapper)wrapper.replaceWith(input);
  };
  const releaseWrapper=onRemoval(wrapper,dispose),releasePanel=onRemoval(panel,dispose);
  const release=()=>{releaseWrapper();releasePanel();};
  refresh();
  if (options.inline) {
    wrapper.hidden = true;
    panel.removeAttribute('popover');
    panel.classList.add('inline-color-picker');
  }
  const control = {
    refresh,
    panel,
    dispose,
    commit: () => {
      if (pending) apply();
    },
  };
  controls.set(input, control);
  return control;
}
