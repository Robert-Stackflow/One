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
  options:{configure?:()=>void}={},
) {
  let mode = true,
    selectionSource: string | undefined,
    config: TranslationConfig | undefined,
    requesting = false,
    notice = '',
    result: TranslationResult | undefined;
  let full: {result:TranslationResult|undefined;text:string}|undefined;
  let generation=0;
  const restore=document.createElement('button');restore.type='button';restore.className='quiet';restore.id='translation-restore-full';restore.textContent='返回全文译文';restore.hidden=true;q('translation-source-note').after(restore);
  function restoreFull(){if(full){result=full.result;q<HTMLTextAreaElement>('translated').value=full.text;full=undefined;}selectionSource=undefined;render();changed();}
  restore.onclick=restoreFull;
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
    q('translation-source-note').textContent = selectionSource === undefined ? '' : '选中文字';
    restore.hidden=selectionSource===undefined||!full;restore.disabled=active||ocr;
    q<HTMLTextAreaElement>('result').readOnly = active || ocr;
    q<HTMLTextAreaElement>('translated').readOnly = active || ocr;
    q<HTMLSelectElement>('translation-language').disabled = active || ocr;
    q<HTMLButtonElement>('translate').disabled =
      active || ocr || !config?.ready || !source().trim() || source().length > TRANSLATION_DOCUMENT_INPUT;
    q<HTMLButtonElement>('translation-configure').disabled = active || ocr;
    q('translation-cancel').hidden = !active;
    q<HTMLButtonElement>('translation-copy').disabled =
      active || !valid() || !q<HTMLTextAreaElement>('translated').value.trim();
    q('translation-configure').title = config?.ready ? (config.serviceName||config.endpoint)+(config.model?' · '+config.model:'') : '配置翻译服务';
    failures.update(result,active||ocr,valid(),q<HTMLTextAreaElement>('translated').value!==result?.text);
    if (notice) { message(notice); notice = ''; }
  }
  function invalidate() {
    if (result && !valid()) notice = '原文、语言或服务已改动，请重新翻译';
    render();
  }
  const settings = mountServiceSettings('translation', {
    services:()=>api.dedicatedServices(),
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
  const openSettings=()=>options.configure?options.configure():void settings.open();
  q('translation-configure').onclick = openSettings;
  q('translation-language').onchange = invalidate;
  q('translated').oninput = render;
  async function translate(retry?:string[]) {
    if (busy() || !config?.ready || !state()) return;
    if(retry&&(!valid()||!result?.id||q<HTMLTextAreaElement>('translated').value!==result.text))return;
    const token=state()!.token,revision=config.revision,input=source(),language=target(),job=result?.id;
    const ticket=++generation,selected=selectionSource!==undefined;
    const current=()=>ticket===generation&&state()?.token===token&&config?.revision===revision&&source()===input&&target()===language&&(selectionSource!==undefined)===selected;
    requesting = true;
    notice = '';
    render();
    changed();
    try {
      const next = await (retry?api.retryTranslation(token,job!,retry,revision,selected):api.translate(token,input,language,revision,selected));
      if(!current())return;
      result=next;
      q<HTMLTextAreaElement>('translated').value = result.text;
      notice = '';
    } catch (error) {
      if(!current())return;
      const partial=await api.partialTranslation(token,revision,selected).catch(()=>undefined);
      if(!current())return;
      if(partial?.parts&&partial.source===input&&partial.target===language&&partial.revision===revision){result=partial;q<HTMLTextAreaElement>('translated').value=partial.text;notice='';}
      else notice = error instanceof Error ? error.message : String(error);
    } finally {
      requesting = false;
      render();
      changed();
    }
  }
  q('translate').onclick = () => { restoreFull(); void translate(); };
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
    ready:()=>!!config?.ready,
    config:()=>config,
    reloadConfig:async()=>{config=await api.translationConfig();invalidate();},
    translateAll:async()=>{restoreFull();await translate();},
    imageReady:()=>!!config?.ready,
    imageValid:(id?:string)=>valid()&&(!id||result?.id===id)&&q<HTMLTextAreaElement>('translated').value===result?.text,
    imageResult:async(force=false)=>{
      restoreFull();
      if(!force&&valid()){
        if(q<HTMLTextAreaElement>('translated').value!==result?.text)
          throw Error('译文已手动修改。请保留当前文字，或点击“翻译全文”重新生成后再制作译图。');
        return result;
      }
      await translate();return valid()?result:undefined;
    },
    async workflowResult(
      value: TranslationResult | undefined,
      language: TranslationLanguage,
      error: string,
    ) {
      const ticket=++generation,token=state()?.token;
      selectionSource = undefined;
      full=undefined;
      q<HTMLSelectElement>('translation-language').value = language;
      result = value;
      q<HTMLTextAreaElement>('translated').value = value?.text || '';
      const nextConfig=await api.translationConfig();
      if(ticket!==generation||state()?.token!==token)return;
      config=nextConfig;
      notice = error;
      render();
    },
    render,
    sourceChanged: () => { ++generation;restoreFull(); invalidate(); },
    translateSelection: (text: string) => { if (!config?.ready) { message('请先配置翻译服务'); openSettings(); return; } if(selectionSource===undefined)full={result,text:q<HTMLTextAreaElement>('translated').value};selectionSource = text;result=undefined;q<HTMLTextAreaElement>('translated').value='';void translate(); },
    busy,
    isTranslation: () => mode,
    setMode: (value: boolean) => {
      mode = value;
      render();
    },
  };
}
