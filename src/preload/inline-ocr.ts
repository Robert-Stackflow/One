import { ipcRenderer } from 'electron';
import type { InlineOCRAPI } from '../shared/recognition/inline-ocr';
const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:inline-ocr-' + name, ...args);
export const inlineOCR: InlineOCRAPI = {
  dedicatedServices:id=>call('services',id),
  translationConfig:id=>call('config',id),saveTranslation:(id,value)=>call('save-config',id,value),clearTranslation:(id,rev)=>call('clear-config',id,rev),taskProfiles:id=>call('profiles',id),migrateService:(id,rev)=>call('migrate',id,rev),restoreService:(id,rev)=>call('restore',id,rev),manageServices:id=>call('manage',id),
  readSource: source => call('source',source),
  prepare: (source, png) => call('prepare', source, png),
  run: (id, language) => call('run', id, language),
  region:(id,language,selection)=>call('region',id,language,selection),
  correct:(id,selection,text)=>call('correct',id,selection,text),
  preview: (id, region) => call('preview', id, region),
  translate: (id, text, target,selection) => call('translate', id, text, target,selection),
  partialTranslation:(id,selection)=>call('translation-partial',id,selection),retryTranslation:(id,job,parts,selection)=>call('translation-retry',id,job,parts,selection),
  copy: (id, text) => call('copy', id, text),
  cancel: id => call('cancel', id),
  release: id => call('release', id),
};
