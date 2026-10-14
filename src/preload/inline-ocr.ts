import { ipcRenderer } from 'electron';
import type { InlineOCRAPI } from '../shared/recognition/inline-ocr';
const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:inline-ocr-' + name, ...args);
export const inlineOCR: InlineOCRAPI = {
  translationConfig:id=>call('config',id),saveTranslation:(id,value)=>call('save-config',id,value),clearTranslation:(id,rev)=>call('clear-config',id,rev),taskProfiles:id=>call('profiles',id),migrateService:(id,rev)=>call('migrate',id,rev),restoreService:(id,rev)=>call('restore',id,rev),manageServices:id=>call('manage',id),
  readSource: source => call('source',source),
  prepare: (source, png) => call('prepare', source, png),
  run: (id, language) => call('run', id, language),
  region:(id,language,selection)=>call('region',id,language,selection),
  correct:(id,selection,text)=>call('correct',id,selection,text),
  preview: (id, region) => call('preview', id, region),
  translate: (id, text, target) => call('translate', id, text, target),
  copy: (id, text) => call('copy', id, text),
  cancel: id => call('cancel', id),
  release: id => call('release', id),
};
