import { mountTextSelection } from '../../src/renderer/recognition/text-selection';
import { textDocument, readingTokens } from '../../src/shared/recognition/text-document';
import type { OCRResult } from '../../src/shared/recognition/ocr';
const state = window as unknown as { fixtureReady: boolean; fixtureCopied: string; fixtureFull: string; fixtureTokenCount: number };
const image = document.querySelector('img')!;
const rows = Array.from({ length: 1200 }, (_, index) => `Line ${String(index).padStart(4, '0')}: One long screenshot`);
const result: OCRResult = { width: 400, height: 16000, language: 'eng', confidence: 90, text: rows.join('\n'), words: rows.map((text, line) => ({
  text, x: 20, y: 10 + line * 13, width: text.length * 8, height: 10, confidence: 90, line,
  symbols: [...text].map((text, index) => ({ text, x: 20 + index * 8, y: 10 + line * 13, width: 8, height: 10, confidence: 90 })),
})) };
const doc = textDocument(result, 'a'.repeat(64), { id: 'fixture', version: '1', model: 'geometry-only', device: 'none' });
state.fixtureCopied = ''; state.fixtureFull = result.text; state.fixtureTokenCount = readingTokens(doc).length;
const selection = mountTextSelection(image, { copy: async text => { state.fixtureCopied = text; }, translate() {}, message() {} });
selection.setDocument(doc);
image.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="16000"><rect width="100%" height="100%" fill="white"/><g font-family="monospace" font-size="10">${rows.map((text, index) => `<text x="20" y="${20 + index * 13}">${text}</text>`).join('')}</g></svg>`);
void image.decode().then(() => { state.fixtureReady = true; });
