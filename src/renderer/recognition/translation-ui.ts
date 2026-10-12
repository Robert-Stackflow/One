import { q } from '../ui';
import { mountServiceSettings } from './service-settings';
import {
  translationLanguages,
  TRANSLATION_INPUT,
  type TranslationLanguage,
  type TranslationConfig,
  type TranslationResult,
} from '../../shared/recognition/translation';
import type { OCRAPI, OCRState } from '../../shared/recognition/ocr';
export function mountTranslation(
  api: OCRAPI,
  state: () => OCRState | undefined,
  message: (value: unknown) => void,
  changed: () => void,
) {
  let mode = false,
    config: TranslationConfig | undefined,
    requesting = false,
    notice = '',
    result: TranslationResult | undefined;
  const source = () => q<HTMLTextAreaElement>('result').value,
    target = () => q<HTMLSelectElement>('translation-language').value as TranslationLanguage;
  const busy = () => requesting || !!state()?.translating;
  const valid = () =>
    !!result &&
    result.source === source() &&
    result.target === target() &&
    result.revision === config?.revision;
  q<HTMLSelectElement>('translation-language').innerHTML = Object.entries(translationLanguages)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  function render() {
    const active = busy(),
      ocr = !!state()?.running || !!state()?.formulaRecognizing;
    q('translation-tools').hidden = !mode;
    q('translation-destination').hidden = !mode;
    q('translation-result').hidden = !mode;
    q('translation-copy').hidden = !mode;
    q('ocr-tools').hidden = mode;
    document.body.classList.toggle('translation-mode', mode);
    q('result-label').textContent = mode ? '原文' : '识别结果';
    q('copy').textContent = mode ? '复制原文' : '复制文字';
    q('copy').classList.toggle('primary', !mode);
    q('copy').classList.toggle('quiet', mode);
    q<HTMLTextAreaElement>('result').readOnly = active || ocr;
    q<HTMLTextAreaElement>('translated').readOnly = active || ocr;
    q<HTMLSelectElement>('translation-language').disabled = active || ocr;
    q<HTMLButtonElement>('translate').disabled =
      active || ocr || !config?.ready || !source().trim() || source().length > TRANSLATION_INPUT;
    q<HTMLButtonElement>('translation-configure').disabled = active || ocr;
    q('translation-cancel').hidden = !active;
    q<HTMLButtonElement>('translation-copy').disabled =
      active || !valid() || !q<HTMLTextAreaElement>('translated').value.trim();
    q('translation-destination').textContent = config?.ready
      ? `将向 ${config.endpoint} 发送原文（${source().length.toLocaleString()} 个字符），图片留在本机。`
      : config?.error || '请先配置翻译服务。配置不会发送文字或图片。';
    q('translation-destination').title = q('translation-destination').textContent || '';
    if (mode)
      message(
        active
          ? '正在翻译原文…'
          : source().length > TRANSLATION_INPUT
            ? '每次最多翻译 20,000 个字符，请分段处理'
            : notice || '可先修正原文，再主动翻译',
      );
  }
  function invalidate() {
    if (result && !valid()) notice = '原文、语言或服务已改动，请重新翻译';
    render();
  }
  const settings = mountServiceSettings('translation', {
    load: () => api.translationConfig(),
    save: (value) => api.saveTranslation(value),
    clear: (revision) => api.clearTranslation(revision),
    available: () => mode && !busy() && !state()?.running && !state()?.formulaRecognizing,
    updated: (value, text) => {
      config = value;
      if (text) notice = text;
      invalidate();
    },
    error: message,
  });
  q('translation-configure').onclick = () => void settings.open();
  q('translation-language').onchange = invalidate;
  q('translated').oninput = render;
  q('translate').onclick = async () => {
    if (busy() || !config?.ready || !state()) return;
    requesting = true;
    notice = '';
    render();
    changed();
    try {
      result = await api.translate(state()!.token, source(), target(), config.revision);
      q<HTMLTextAreaElement>('translated').value = result.text;
      notice = '翻译完成，可核对、修正和复制译文';
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      requesting = false;
      render();
      changed();
    }
  };
  q('translation-cancel').onclick = () =>
    void api.cancelTranslation().catch((error) => {
      notice = String(error);
      render();
    });
  q('translation-copy').onclick = () => {
    if (!valid()) return;
    void api
      .copy(q<HTMLTextAreaElement>('translated').value)
      .then(() => {
        notice = '已复制译文';
        render();
      })
      .catch((error) => {
        notice = String(error);
        render();
      });
  };
  return {
    async workflowResult(
      value: TranslationResult | undefined,
      language: TranslationLanguage,
      error: string,
    ) {
      q<HTMLSelectElement>('translation-language').value = language;
      result = value;
      q<HTMLTextAreaElement>('translated').value = value?.text || '';
      config = await api.translationConfig();
      notice = value ? '流程翻译完成，可核对、修正和复制译文' : error;
      render();
    },
    render,
    sourceChanged: invalidate,
    busy,
    isTranslation: () => mode,
    setMode: (value: boolean) => {
      mode = value;
      render();
    },
  };
}
