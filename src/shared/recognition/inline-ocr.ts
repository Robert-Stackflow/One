import type { OCRLanguage, OCRResult } from './ocr';
import type { OCRImagePreviewRequest } from './image-preview';
import type { TranslationLanguage, TranslationResult } from './translation';

/** A frozen image owned by one existing preview/editor window. */
export interface InlineOCRAPI {
  readSource(source:string):Promise<Uint8Array>;
  prepare(source: string, png: string): Promise<{ id: string; width: number; height: number }>;
  run(id: string, language: OCRLanguage): Promise<OCRResult>;
  region(id:string,language:OCRLanguage,selection:import('./text-region').OCRRegionSelection):Promise<OCRResult>;
  preview(id: string, region: OCRImagePreviewRequest): Promise<Uint8Array>;
  translate(id: string, text: string, target: TranslationLanguage): Promise<TranslationResult>;
  copy(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
  release(id: string): Promise<void>;
}
