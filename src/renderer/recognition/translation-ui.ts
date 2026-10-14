import { q } from '../ui';
import { mountServiceSettings } from './service-settings';
import {mountTranslationFailures} from './translation-failures';
import {
  translationLanguages,
  TRANSLATION_DOCUMENT_INPUT,
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
  let mode = true,
    selectionSource: string | undefined,
    config: TranslationConfig | undefined,
    requesting = false,
    notice = '',
    result: TranslationResult | undefined;
  const source = () => selectionSource ?? q<HTMLTextAreaElement>('result').value,
    target = () => q<HTMLSelectElement>('translation-language').value as TranslationLanguage;
  const busy = () => requesting || !!state()?.translating;
  const failures=mountTranslationFailures(q('translated'),ids=>void translate(ids));
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
    q('translation-destination').hidden = true;
    q('translation-result').hidden = !mode;
    q('translation-copy').hidden = !mode;
    q('ocr-tools').hidden = false;
    q('translation-source-note').textContent = selectionSource === undefined ? '' : '选中文字';
    q<HTMLTextAreaElement>('result').readOnly = active || ocr;
    q<HTMLTextAreaElement>('translated').readOnly = active || ocr;
    q<HTMLSelectElement>('translation-language').disabled = active || ocr;
    q<HTMLButtonElement>('translate').disabled =
      active || ocr || !config?.ready || !source().trim() || source().length > TRANSLATION_DOCUMENT_INPUT;
    q<HTMLButtonElement>('translation-configure').disabled = active || ocr;
    q('translation-cancel').hidden = !active;
    q<HTMLButtonElement>('translation-copy').disabled =
      active || !valid() || !q<HTMLTextAreaElement>('translated').value.trim();
    q('translation-configure').title = config?.ready ? (config.serviceName||config.endpoint)+' · '+config.model : '配置翻译服务';
    failures.update(result,active||ocr,valid(),q<HTMLTextAreaElement>('translated').value!==result?.text);
    if (notice) { message(notice); notice = ''; }
  }
  function invalidate() {
    if (result && !valid()) notice = '原文、语言或服务已改动，请重新翻译';
    render();
  }
  const settings = mountServiceSettings('translation', {
    profiles:()=>api.taskProfiles(),verify:ref=>api.verifyServiceImage(ref),cancelCheck:()=>api.cancelServiceCheck(),migrate:rev=>api.migrateService(rev),restore:rev=>api.restoreService(rev),manage:()=>api.manageServices(),
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
  async function translate(retry?:string[]) {
    if (busy() || !config?.ready || !state()) return;
    if(retry&&(!valid()||!result?.id||q<HTMLTextAreaElement>('translated').value!==result.text))return;
    const token=state()!.token,revision=config.revision,input=source(),language=target(),job=result?.id;
    requesting = true;
    notice = '';
    render();
    changed();
    try {
      result = await (retry?api.retryTranslation(token,job!,retry,revision):api.translate(token,input,language,revision));
      q<HTMLTextAreaElement>('translated').value = result.text;
      notice = '';
    } catch (error) {
      const partial=await api.partialTranslation(token,revision).catch(()=>undefined);
      if(partial?.parts&&partial.source===input&&partial.target===language&&partial.revision===revision){result=partial;q<HTMLTextAreaElement>('translated').value=partial.text;notice='';}
      else notice = error instanceof Error ? error.message : String(error);
    } finally {
      requesting = false;
      render();
      changed();
    }
  }
  q('translate').onclick = () => { selectionSource = undefined; void translate(); };
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
      selectionSource = undefined;
      q<HTMLSelectElement>('translation-language').value = language;
      result = value;
      q<HTMLTextAreaElement>('translated').value = value?.text || '';
      config = await api.translationConfig();
      notice = value ? '流程翻译完成，可核对、修正和复制译文' : error;
      render();
    },
    render,
    sourceChanged: () => { selectionSource = undefined; invalidate(); },
    translateSelection: (text: string) => { selectionSource = text; if (!config?.ready) { message('请先配置翻译服务'); void settings.open(); return; } void translate(); },
    busy,
    isTranslation: () => mode,
    setMode: (value: boolean) => {
      mode = value;
      render();
    },
  };
}
