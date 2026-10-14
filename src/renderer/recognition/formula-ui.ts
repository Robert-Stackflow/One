import { q } from '../ui';
import 'katex/dist/katex.min.css';
import { mountServiceSettings } from './service-settings';
import { formulaText, FORMULA_TEXT, FORMULA_IMAGE } from '../../shared/recognition/formula';
import type { TranslationConfig } from '../../shared/recognition/translation';
import type { FormulaRecognitionAPI, OCRState } from '../../shared/recognition/ocr';
export function mountFormula(
  api: FormulaRecognitionAPI,
  state: () => OCRState | undefined,
  message: (value: unknown) => void,
  changed: () => void,
) {
  let mode = false,
    requesting = false,
    config: TranslationConfig | undefined,
    notice = '',
    worker: Worker | undefined,
    previewTimer: ReturnType<typeof setTimeout> | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined,
    serial = 0;
  const editor = q<HTMLTextAreaElement>('formula-text'),
    preview = q('formula-preview'),
    previewState = q('formula-preview-status');
  editor.maxLength = FORMULA_TEXT;
  const busy = () => requesting || !!state()?.formulaRecognizing;
  function render() {
    const active = busy(),
      other = !!state()?.running || !!state()?.translating,
      large = (state()?.imageBytes || 0) > FORMULA_IMAGE;
    q('formula-panel').hidden = !mode;
    q('formula-tools').hidden = !mode;
    q('formula-destination').hidden = true;
    q('formula-copy').hidden = !mode;
    q<HTMLButtonElement>('formula-recognize').disabled = active || other || large || !config?.ready;
    q<HTMLButtonElement>('formula-configure').disabled = active || other;
    editor.readOnly = active || other;
    q<HTMLButtonElement>('formula-copy').disabled =
      active || !editor.value.trim() || editor.value.length > FORMULA_TEXT;
    q('formula-configure').title = config?.ready ? config.endpoint : '配置视觉服务';
    q('formula-recognize').title = large ? '图片超过 8 MiB，请先裁剪' : '发送当前图片并识别公式';
    q('image-loading').hidden = !active;
    q('source').parentElement!.ariaBusy = String(active);
    if (notice) { message(notice); notice = ''; }
  }
  const settings = mountServiceSettings('formula', {
    profiles:()=>api.taskProfiles(),verify:ref=>api.verifyServiceImage(ref),cancelCheck:()=>api.cancelServiceCheck(),migrate:rev=>api.migrateService(rev),restore:rev=>api.restoreService(rev),manage:()=>api.manageServices(),
    load: () => api.formulaConfig(),
    save: (value) => api.saveFormula(value),
    clear: (revision) => api.clearFormula(revision),
    available: () => mode && !busy() && !state()?.running && !state()?.translating,
    updated: (value, text) => {
      config = value;
      if (text) notice = text;
      render();
    },
    error: message,
  });
  q('formula-configure').onclick = () => void settings.open();
  function stopPreview() {
    serial++;
    if (previewTimer) clearTimeout(previewTimer);
    if (deadline) clearTimeout(deadline);
    worker?.terminate();
    worker = undefined;
  }
  function updatePreview() {
    stopPreview();
    preview.replaceChildren();
    preview.removeAttribute('aria-busy');
    const text = editor.value,
      id = serial;
    if (!text.trim()) {
      previewState.textContent = '';
      preview.removeAttribute('aria-busy');
      return;
    }
    try {
      formulaText(text);
    } catch (error) {
      previewState.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    previewState.textContent = '正在生成本机预览…';
    preview.ariaBusy = 'true';
    previewTimer = setTimeout(() => {
      try {
        const current = (worker = new Worker(new URL('./formula-preview.ts',import.meta.url),{type:'module'}));
        const finish = (error: string, html = '') => {
          if (id !== serial) return;
          if (deadline) clearTimeout(deadline);
          current.terminate();
          if (worker === current) worker = undefined;
          preview.removeAttribute('aria-busy');
          previewState.textContent = error
            ? '预览不可用：' + error
            : '';
          if (html) preview.innerHTML = html;
        };
        current.onmessage = (event: MessageEvent<{ id: number; html: string; error: string }>) => {
          if (event.data.id === id) finish(event.data.error, event.data.html);
        };
        current.onerror = () => finish('预览组件无法加载，可继续编辑和复制 LaTeX');
        deadline = setTimeout(() => finish('公式过于复杂，请分段处理'), 2000);
        current.postMessage({ id, text });
      } catch {
        preview.removeAttribute('aria-busy');
        previewState.textContent = '预览组件无法加载，可继续编辑和复制 LaTeX';
      }
    }, 180);
  }
  editor.oninput = () => {
    notice = '';
    updatePreview();
    render();
  };
  q('formula-recognize').onclick = async () => {
    if (busy() || !config?.ready || !state()) return;
    requesting = true;
    notice = '';
    render();
    changed();
    try {
      const result = await api.recognizeFormula(state()!.token, config.revision);
      editor.value = result.text;
      updatePreview();
      notice = '';
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      requesting = false;
      render();
      changed();
    }
  };
  q('overlay-cancel').onclick = () => void api.cancelFormula().catch(message);
  q('formula-copy').onclick = () =>
    void api
      .copyFormula(editor.value)
      .then(() => {
        notice = '已复制当前 LaTeX';
        render();
      })
      .catch(message);
  window.addEventListener('beforeunload', stopPreview);
  return {
    render,
    busy,
    setMode: (value: boolean) => {
      mode = value;
      render();
    },
  };
}
