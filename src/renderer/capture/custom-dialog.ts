import type {OneAPI} from '../../shared/types';
import type {CaptureOptions,CaptureScreen} from '../../shared/capture/api';
import {applyCaptureScale} from './appearance';
import {
  customCaptureFrom,
  customCaptureSelection,
  type CustomCapture,
} from '../../shared/capture/custom-capture';
import {dialogMarkup,openDialog,closeDialog} from '../dialog';
import {customControls,closeControls,selectSource} from '../controls';
import { icon } from '../ui';
import './custom-dialog.css';

export function openCustomCapture(
  api: Pick<OneAPI,'patchSettings'> & {captureCustom(...args:Parameters<OneAPI['captureCustom']>):Promise<unknown>},
  get: () => {screens:CaptureScreen[];displayId:number;custom:CustomCapture;uiScale:100|110|125|150},
  report: (error: unknown) => void,
  displayId?: number,
  captureOptions?: CaptureOptions,
) {
  const existing = document.getElementById('custom-capture-dialog');
  if (existing) {
    existing.querySelector<HTMLElement>('input')?.focus();
    return;
  }
  let value = structuredClone(get().custom),
    busy = false,
    closing = false,
    cancelled = false,
    timer: ReturnType<typeof setTimeout> | undefined;

  const number = (id: string, v: number, min = 0, max = 32768, step = 1) =>
    `<input type="number" id="${id}" value="${v}" min="${min}" max="${max}" step="${step}" aria-label="${{ cx: '左上角 X', cy: '左上角 Y', cw: '截屏宽度', ch: '截屏高度', cd: '延迟秒数' }[id] || id}">`;
  const template=document.createElement('template');
  template.innerHTML=dialogMarkup({id:'custom-capture-dialog',title:'自定义截屏',closeId:'modal-close',className:'custom-capture-dialog',body:`
    <p class="custom-capture-note">位置相对于所选显示器的左上角，尺寸使用实际像素。未指定位置时，选区居中显示，可继续移动和编辑。</p>
    <label class="custom-capture-screen">显示器<select id="custom-display">${get()
      .screens.map(
        (s) =>
          `<option value="${s.id}">${s.name.replace(/[&<>"']/g, '')} · ${s.width} × ${s.height}</option>`,
      )
      .join('')}</select></label>
    <div class="custom-capture-row"><label><input type="checkbox" id="use-position" ${value.position ? 'checked' : ''}>左上角</label><div class="custom-capture-pair">${number('cx', value.x)}<span>×</span>${number('cy', value.y)}<span>px</span></div></div>
    <div class="custom-capture-row"><label><input type="checkbox" id="use-size" ${value.size ? 'checked' : ''}>固定尺寸</label><div class="custom-capture-pair">${number('cw', value.width, 2)}<span>×</span>${number('ch', value.height, 2)}<span>px</span></div></div>
    <div class="custom-capture-presets"><select id="custom-presets" aria-label="尺寸预设"></select><button type="button" class="quiet" id="preset-add">${icon('lucide:plus')}保存为预设</button><button type="button" class="quiet icon-button" id="presets-edit" aria-label="编辑尺寸预设">${icon('lucide:pencil')}</button></div>
    <div class="custom-presets-editor" hidden><div id="custom-preset-rows"></div></div>
    <div class="custom-capture-row"><label><input type="checkbox" id="use-delay" ${value.delayed ? 'checked' : ''}>延迟截屏</label><div class="custom-capture-delay">${number('cd', value.delay, 0, 60, 0.1)}<span>秒（0–60）</span></div></div>
    <div class="custom-capture-status" role="status" aria-live="polite"></div>`+ '<p id="modal-error" role="alert" class="custom-capture-error"></p>',actions:'<button type="button" id="custom-cancel" class="quiet">取消</button><button type="button" id="custom-save">保存设置</button><button type="submit" class="primary" id="custom-start">开始截图</button>'});
  const dialog=template.content.firstElementChild as HTMLDialogElement;
  const form=document.createElement('form');form.noValidate=true;form.append(...dialog.childNodes);dialog.append(form);
  applyCaptureScale(dialog,get().uiScale);
  document.body.append(dialog);
  const q = <T extends HTMLElement = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const select=(selector:string)=>selectSource(q(selector))!;
  select('#custom-display').value = String(displayId ?? get().displayId);
  function refreshPresets() {
    const select = selectSource(q('#custom-presets'))!;
    select.replaceChildren(new Option('尺寸预设', ''));
    for (const [i, p] of value.presets.entries())
      select.add(new Option(`${p.width} × ${p.height}`, String(i)));
    select.dispatchEvent(new Event('optionschange'));
    q('#custom-preset-rows').innerHTML =
      value.presets
        .map(
          (p, i) =>
            `<div class="custom-preset-row"><input type="number" min="2" max="32768" value="${p.width}" aria-label="预设 ${i + 1} 宽度" data-preset="${i}" data-axis="width"><span>×</span><input type="number" min="2" max="32768" value="${p.height}" aria-label="预设 ${i + 1} 高度" data-preset="${i}" data-axis="height"><button type="button" class="quiet icon-button" data-remove="${i}" aria-label="删除预设 ${i + 1}">${icon('lucide:trash')}</button></div>`,
        )
        .join('') || '<p class="custom-capture-note">还没有尺寸预设。</p>';
    q('#custom-preset-rows')
      .querySelectorAll<HTMLInputElement>('[data-preset]')
      .forEach(
        (input) =>
          (input.onchange = () => {
            value.presets[Number(input.dataset.preset)][input.dataset.axis as 'width' | 'height'] =
              Number(input.value);
          }),
      );
    q('#custom-preset-rows')
      .querySelectorAll<HTMLButtonElement>('[data-remove]')
      .forEach(
        (button) =>
          (button.onclick = () => {
            value.presets.splice(Number(button.dataset.remove), 1);
            refreshPresets();
          }),
      );
  }
  const fields = () => ({
    ...value,
    position: q<HTMLInputElement>('#use-position').checked,
    x: q<HTMLInputElement>('#cx').valueAsNumber,
    y: q<HTMLInputElement>('#cy').valueAsNumber,
    size: q<HTMLInputElement>('#use-size').checked,
    width: q<HTMLInputElement>('#cw').valueAsNumber,
    height: q<HTMLInputElement>('#ch').valueAsNumber,
    delayed: q<HTMLInputElement>('#use-delay').checked,
    delay: q<HTMLInputElement>('#cd').valueAsNumber,
  });
  const showError = (e: unknown) => {
    q('#modal-error').textContent = e instanceof Error ? e.message : String(e);
  };
  const dismiss = async (cancel = true) => {
    if (cancel) cancelled = true;
    if (closing) return;
    closing = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    busy = false;
    closeControls();
    if (!(await closeDialog(dialog))) return;
    dialog.remove();
  };
  q('#modal-close').onclick = () => void dismiss();
  q('#custom-cancel').onclick = () => void dismiss();
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    void dismiss();
  });
  q('#presets-edit').onclick = () => {
    q('.custom-presets-editor').hidden = !q('.custom-presets-editor').hidden;
  };
  q<HTMLSelectElement>('#custom-presets').onchange = () => {
    const index = select('#custom-presets').value;
    if (index === '') return;
    const p = value.presets[Number(index)];
    q<HTMLInputElement>('#cw').value = String(p.width);
    q<HTMLInputElement>('#ch').value = String(p.height);
    q<HTMLInputElement>('#use-size').checked = true;
    sync();
  };
  q('#preset-add').onclick = () => {
    try {
      const next = fields(),
        p = { width: next.width, height: next.height };
      if (value.presets.some((s) => s.width === p.width && s.height === p.height))
        throw Error('这个尺寸已经在预设中');
      value = customCaptureFrom({ ...next, presets: [...value.presets, p] });
      refreshPresets();
      q('#modal-error').textContent = '';
    } catch (e) {
      showError(e);
    }
  };
  function sync() {
    for (const [toggle, ids] of [
      ['use-position', ['cx', 'cy']],
      ['use-size', ['cw', 'ch']],
      ['use-delay', ['cd']],
    ] as const)
      for (const id of ids)
        q<HTMLInputElement>('#' + id).disabled = !q<HTMLInputElement>('#' + toggle).checked;
  }
  ['use-position', 'use-size', 'use-delay'].forEach(
    (id) => (q<HTMLInputElement>('#' + id).onchange = sync),
  );
  async function commit(start: boolean) {
    if (busy) return;
    try {
      value = customCaptureFrom(fields());
      const display = get().screens.find(
        (s) => s.id === Number(select('#custom-display').value),
      );
      if (!display) throw Error('显示器已断开');
      customCaptureSelection(value, display.width, display.height);
      busy = true;
      q('#modal-error').textContent = '';
      await api.patchSettings({capture:{custom:value}});
      if (cancelled || !dialog.isConnected) return;
      if (!start) {
        await dismiss(false);
        return;
      }
      dialog
        .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,select,button')
        .forEach((b) => {
          if (!['modal-close', 'custom-cancel'].includes(b.id)) b.disabled = true;
        });
      const ready = async () => {
        if (cancelled || closing || !dialog.isConnected) return;
        const options = structuredClone(value),
          id = display.id;
        await dismiss(false);
        if (!cancelled) void api.captureCustom(options, id, captureOptions).catch(report);
      };
      const end = Date.now() + (value.delayed ? value.delay * 1000 : 0);
      const tick = () => {
        if (cancelled || !dialog.isConnected) return;
        const remaining = end - Date.now();
        if (remaining <= 0) {
          void ready();
          return;
        }
        q('.custom-capture-status').textContent =
          `${(remaining / 1000).toFixed(1)} 秒后截图，可切换到目标窗口；Esc 取消。`;
        timer = setTimeout(tick, 100);
      };
      tick();
    } catch (e) {
      busy = false;
      showError(e);
    }
  }
  q('#custom-save').onclick = () => void commit(false);
  q<HTMLFormElement>('form').onsubmit = (e) => {
    e.preventDefault();
    void commit(true);
  };
  refreshPresets();
  sync();
  customControls(dialog);
  dialog.addEventListener('close',()=>{if(!closing)cancelled=true;if(timer)clearTimeout(timer);closeControls();dialog.remove();});
  // A backdrop/header close must cancel the delayed capture before its next tick.
  dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if((event.target as Element).closest('[data-dialog-dismiss]')||event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))void dismiss();},true);
  openDialog(dialog);
  return ()=>void dismiss();
}
