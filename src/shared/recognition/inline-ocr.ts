import type { OCRLanguage, OCRResult } from './ocr';
import type { OCRImagePreviewRequest } from './image-preview';
import type { TranslationLanguage, TranslationResult } from './translation';

/** A frozen image owned by one existing preview/editor window. */
export interface InlineOCRAPI {
  translationConfig(id:string):Promise<import('./translation').TranslationConfig>;
  saveTranslation(id:string,value:import('./translation').TranslationSettings):Promise<import('./translation').TranslationConfig>;
  clearTranslation(id:string,revision:string):Promise<import('./translation').TranslationConfig>;
  taskProfiles(id:string):Promise<import('../ai-task').AITaskProfile[]>;
  migrateService(id:string,revision:string):Promise<import('../ai-task').AITaskReference|import('./translation-services').TranslationServiceReference>;
  dedicatedServices(id:string):Promise<import('./translation-services').TranslationServiceProfile[]>;
  restoreService(id:string,revision:string):Promise<import('./translation').TranslationConfig>;
  manageServices(id:string):Promise<void>;
  correct(id:string,selection:import('./text-region').OCRRegionSelection,text:string):Promise<OCRResult>;
  readSource(source:string):Promise<Uint8Array>;
  prepare(source: string, png: string): Promise<{ id: string; width: number; height: number }>;
  run(id: string, language: OCRLanguage): Promise<OCRResult>;
  region(id:string,language:OCRLanguage,selection:import('./text-area').OCRLocalSelection):Promise<OCRResult>;
  preview(id: string, region: OCRImagePreviewRequest): Promise<Uint8Array>;
  translate(id: string, text: string, target: TranslationLanguage,selection?:boolean): Promise<TranslationResult>;
  partialTranslation(id:string,selection?:boolean):Promise<TranslationResult|undefined>;
  retryTranslation(id:string,job:string,parts:string[],selection?:boolean):Promise<TranslationResult>;
  copy(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
  release(id: string): Promise<void>;
}
