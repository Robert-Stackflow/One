import './sensitive-controls.css';
import { createElement, Info } from 'lucide';
import {
  sensitiveResult,
  sensitiveNames,
  type SensitiveAPI,
  type SensitiveResult,
} from '../../shared/recognition/sensitive-api';
import { ocrDimensions } from '../../shared/recognition/ocr-limits';
import { validateImageDocument, type ImageDocument } from '../../shared/capture/image-document';
import { captureOutput } from './capture-paint';
import { canvasPng } from './image-encode';
import { customControls } from '../controls';
import { sensitiveAnnotations } from '../../shared/capture/sensitive-annotations';

interface Host {
  api: SensitiveAPI;
  token(): string;
  locked(): boolean;
  document(): ImageDocument;
  source(): CanvasImageSource;
  pending(value: boolean): void;
  preview(value: ImageDocument): void;
  commit(value: ImageDocument): void;
  message(value: unknown): void;
}
export function sensitiveControls(root: HTMLElement, host: Host) {
  root.classList.add('sensitive-controls');
  root.innerHTML = `<button id="sensitive-scan" type="button">识别敏感文字</button>
    <span class="sensitive-help" tabindex="0" title="本机识别联系方式、证件号码及带标签的姓名、地址、密码。请检查漏识别和误识别。" aria-label="敏感文字识别说明"></span>
    <div id="sensitive-review" hidden><span id="sensitive-count" role="status"></span>
      <label>方式<select id="sensitive-mode" aria-label="敏感文字遮盖方式"><option value="solid">实色遮盖</option><option value="mosaic">马赛克</option></select></label>
      <button id="sensitive-apply" type="button">应用遮盖</button></div>
    <button id="sensitive-cancel" type="button" class="quiet" hidden>取消</button>`;
  root.querySelector('.sensitive-help')!.append(createElement(Info, { 'aria-hidden': 'true' }));
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const scan = get<HTMLButtonElement>('sensitive-scan'),
    review = get('sensitive-review'),
    cancel = get<HTMLButtonElement>('sensitive-cancel'),
    apply = get<HTMLButtonElement>('sensitive-apply'),
    mode = get<HTMLSelectElement>('sensitive-mode');
  let phase: 'idle' | 'running' | 'review' | 'canceling' = 'idle',
    serial = 0;
  let before: ImageDocument | undefined,
    result: SensitiveResult | undefined,
    preview: ImageDocument | undefined;
  const refresh = () => {
    scan.disabled = phase !== 'idle' || host.locked();
    review.hidden = phase !== 'review';
    cancel.hidden = phase !== 'review';
    cancel.disabled = phase === 'canceling';
    apply.disabled = mode.disabled = phase !== 'review';
  };
  const reset = () => {
    if (before) host.preview(before);
    before = result = preview = undefined;
    phase = 'idle';
    host.pending(false);
    refresh();
  };
  const makePreview = () => {
    if (!before || !result) return;
    preview = sensitiveAnnotations(before, result, mode.value === 'mosaic' ? 'mosaic' : 'solid');
    validateImageDocument(preview, before.original);
    host.preview(preview);
  };
  scan.onclick = async () => {
    if (phase !== 'idle' || host.locked()) return;
    const current = ++serial;
    before = host.document();
    phase = 'running';
    host.pending(true);
    host.message('正在本机识别敏感文字，可按 Esc 取消…');
    refresh();
    let canvas: HTMLCanvasElement | undefined;
    try {
      if (!before.selection) throw Error('请先选择图像区域');
      ocrDimensions(Math.ceil(before.selection.width), Math.ceil(before.selection.height));
      canvas = captureOutput(host.source(), {
        ...before,
        effects: { ...before.effects, shadow: { ...before.effects.shadow, enabled: false } },
      });
      const png = await canvasPng(canvas);
      if (current !== serial) return;
      const value = sensitiveResult(await host.api.scanSensitive(host.token(), png));
      if (current !== serial) return;
      if (value.width !== canvas.width || value.height !== canvas.height)
        throw Error('敏感文字识别尺寸不一致');
      if (!value.regions.length) {
        reset();
        host.message('未找到常见敏感文字，请检查图像，必要时手动遮盖。');
        return;
      }
      result = value;
      makePreview();
      phase = 'review';
      const counts = new Map<string, number>();
      for (const region of value.regions)
        counts.set(sensitiveNames[region.kind], (counts.get(sensitiveNames[region.kind]) || 0) + 1);
      get('sensitive-count').textContent =
        `找到 ${value.regions.length} 处：` +
        [...counts].map(([name, count]) => name + ' ' + count).join('、');
      host.message('请检查遮盖预览；确认后整批应用，可一次撤销，也可逐个调整或删除。');
      refresh();
    } catch (error) {
      if (current === serial) {
        reset();
        host.message(error);
      }
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
    }
  };
  mode.onchange = () => {
    if (phase !== 'review') return;
    try {
      makePreview();
    } catch (error) {
      reset();
      host.message(error);
    }
  };
  apply.onclick = () => {
    if (phase !== 'review' || !preview) return;
    const value = preview;
    ++serial;
    reset();
    host.commit(value);
    host.message('已应用敏感文字遮盖，可一次撤销。');
  };
  const dismiss = async () => {
    if (phase === 'idle' || phase === 'canceling') return;
    const running = phase === 'running';
    ++serial;
    phase = 'canceling';
    refresh();
    let failure: unknown;
    try {
      if (running) await host.api.cancelSensitive(host.token());
    } catch (error) {
      failure = error;
    } finally {
      reset();
      host.message(failure || '已取消敏感文字识别，可继续编辑。');
    }
  };
  cancel.onclick = () => {
    void dismiss();
  };
  customControls(root);
  refresh();
  return {
    get active() {
      return phase !== 'idle';
    },
    refresh,
    cancel: dismiss,
  };
}
