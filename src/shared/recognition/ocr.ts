import {ocrDimensions,OCR_TEXT} from './ocr-limits';
export {ocrDimensions,OCR_PIXELS,OCR_EDGE,OCR_TEXT} from './ocr-limits';
export type OCRLanguage = 'eng' | 'chi_sim+eng';
export interface OCRSymbol {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OCRWord {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  line: number;
  block?: number;
  symbols?: OCRSymbol[];
}
export interface OCRResult {
  text: string;
  confidence: number;
  width: number;
  height: number;
  words: OCRWord[];
  language: OCRLanguage;
  document?: import('./text-document').TextDocument;
}
export interface OCRState {
  uiScale:100|110|125|150;
  workflow?: OCRWorkflowState;
  token: string;
  name: string;
  image: string;
  width: number;
  height: number;
  running: boolean;
  translating: boolean;
  formulaRecognizing: boolean;
  imageBytes: number;
  progress: number;
  error: string;
  models: { ready: boolean; downloading: boolean; progress: number; error: string };
}
export interface OCRAPI {
  returnToCapture(token: string, id: string): Promise<void>;
  workflowResult(token: string, id: string): Promise<OCRWorkflowResult>;
  state(): Promise<OCRState>;
  run(token: string, language: OCRLanguage): Promise<OCRResult>;
  cancel(): Promise<void>;
  install(): Promise<void>;
  cancelInstall(): Promise<void>;
  copy(text: string): Promise<void>;
  translationConfig(): Promise<TranslationConfig>;
  saveTranslation(value: TranslationSettings): Promise<TranslationConfig>;
  clearTranslation(revision: string): Promise<TranslationConfig>;
  translate(
    token: string,
    text: string,
    target: TranslationLanguage,
    revision: string,
  ): Promise<TranslationResult>;
  cancelTranslation(): Promise<void>;
  formulaConfig(): Promise<TranslationConfig>;
  saveFormula(value: TranslationSettings): Promise<TranslationConfig>;
  clearFormula(revision: string): Promise<TranslationConfig>;
  recognizeFormula(token: string, revision: string): Promise<FormulaResult>;
  cancelFormula(): Promise<void>;
  copyFormula(text: string): Promise<void>;
}
export interface OCRWorkflowState {
  returnToCapture?: boolean;
  id: string;
  target: TranslationLanguage;
  status: 'recognizing' | 'translating' | 'done' | 'failed' | 'canceled';
  error: string;
}
export interface OCRWorkflowResult {
  source: string;
  words: number;
  confidence: number;
  translation?: TranslationResult;
  document?: import('./text-document').TextDocument;
}
export function ocrLanguage(value: unknown): OCRLanguage {
  if (value !== 'eng' && value !== 'chi_sim+eng') throw Error('识别语言无效');
  return value;
}
export function ocrText(value: unknown) {
  if (typeof value !== 'string' || value.length > OCR_TEXT) throw Error('识别文字过长');
  return value;
}
export function ocrResult(
  value: unknown,
  size: { width: number; height: number },
  language: OCRLanguage,
): OCRResult {
  const v = value as OCRResult;
  ocrDimensions(size.width, size.height);
  if (
    !v ||
    v.width !== size.width ||
    v.height !== size.height ||
    v.language !== language ||
    !Number.isFinite(v.confidence) ||
    v.confidence < 0 ||
    v.confidence > 100 ||
    !Array.isArray(v.words) ||
    v.words.length > 50000
  )
    throw Error('文字识别结果无效');
  let symbolCount = 0;
  const text = ocrText(v.text),
    words = v.words.map((w) => {
      if (
        !w ||
        typeof w.text !== 'string' ||
        w.text.length > 4096 ||
        ![w.x, w.y, w.width, w.height, w.line, w.confidence].every(Number.isFinite) ||
        ![w.x, w.y, w.width, w.height, w.line].every(Number.isInteger) ||
        w.x < 0 ||
        w.y < 0 ||
        w.width < 0 ||
        w.height < 0 ||
        w.x + w.width > size.width ||
        w.y + w.height > size.height ||
        w.line < 0 ||
        w.line > 50000 ||
        w.confidence < 0 ||
        w.confidence > 100
      )
        throw Error('文字位置结果无效');
      if (w.block !== undefined && (!Number.isSafeInteger(w.block) || w.block < 0 || w.block > 50000))
        throw Error('文字段落结果无效');
      if (w.symbols !== undefined && !Array.isArray(w.symbols)) throw Error('文字字形结果无效');
      const symbols = w.symbols?.map(symbol => {
        if (++symbolCount > 200000 || !symbol || typeof symbol.text !== 'string' || symbol.text.length > 64 ||
            ![symbol.x, symbol.y, symbol.width, symbol.height].every(Number.isSafeInteger) ||
            symbol.x < 0 || symbol.y < 0 || symbol.width < 0 || symbol.height < 0 ||
            symbol.x + symbol.width > size.width || symbol.y + symbol.height > size.height ||
            !Number.isFinite(symbol.confidence) || symbol.confidence < 0 || symbol.confidence > 100)
          throw Error('文字字形位置结果无效');
        return { text: symbol.text, confidence: symbol.confidence, x: symbol.x, y: symbol.y, width: symbol.width, height: symbol.height };
      });
      return {
        text: w.text,
        confidence: w.confidence,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        line: w.line,
        ...(w.block === undefined ? {} : { block: w.block }),
        ...(symbols === undefined ? {} : { symbols }),
      };
    });
  return {
    text,
    confidence: v.confidence,
    width: size.width,
    height: size.height,
    language,
    words,
  };
}
import type {
  TranslationConfig,
  TranslationSettings,
  TranslationLanguage,
  TranslationResult,
} from './translation';
import type { FormulaResult } from './formula';
