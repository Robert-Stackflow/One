import test from 'node:test';
import assert from 'node:assert/strict';
import { ocrResult, type OCRResult, type OCRSymbol } from '../../src/shared/recognition/ocr';
import { readingTokens, selectedText, textDocument, textGroup, textVertical, type TextQuad } from '../../src/shared/recognition/text-document';
import { imageToTextView, textViewToImage, textViewSize, insideTextQuad, type TextRotation } from '../../src/shared/recognition/text-geometry';
const hash = 'a'.repeat(64), engine = { id: 'tesseract', version: '7.0.0', model: 'fixture', device: 'cpu', confidenceScale: 100 };
const glyph = (text: string, x: number, y = 0, width = 10): OCRSymbol => ({ text, x, y, width, height: 10, confidence: 90 });
function sample(): OCRResult {
  return { text: 'One 文字\n第二行\n\nRight', width: 200, height: 100, language: 'chi_sim+eng', confidence: 90, words: [
    { text: 'One', x: 0, y: 0, width: 30, height: 10, confidence: 90, line: 0, block: 0,
      symbols: [glyph('O', 0, 0, 12), glyph('n', 12, 0, 8), glyph('e', 20)] },
    { text: '文字', x: 40, y: 0, width: 20, height: 10, confidence: 90, line: 0, block: 0,
      symbols: [glyph('文', 40), glyph('字', 50)] },
    { text: '第二行', x: 0, y: 20, width: 30, height: 10, confidence: 90, line: 1, block: 0,
      symbols: [glyph('第', 0, 20), glyph('二', 10, 20), glyph('行', 20, 20)] },
    { text: 'Right', x: 100, y: 0, width: 60, height: 10, confidence: 88, line: 2, block: 1 },
  ] };
}
test('document keeps engine reading order, true non-uniform glyph boxes and exact mixed-language separators', () => {
  const result = sample(), doc = textDocument(ocrResult(result, result, result.language), hash, engine), tokens = readingTokens(doc);
  assert.equal(doc.alignment, 'source');
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0].lines.length, 2);
  assert.deepEqual(tokens.slice(0, 3).map(token => token.quad[1].x - token.quad[0].x), [12, 8, 10]);
  assert.equal(selectedText(tokens, 0, tokens.length - 1), result.text);
  assert.equal(selectedText(tokens, 4, 2), 'e 文字');
  assert.equal(selectedText(tokens, 6, 7), '二行');
  assert.equal(tokens.at(-1)!.geometry, 'word');
  assert.deepEqual(textGroup(tokens, 1, 'word'), { anchor: 0, focus: 2 });
  assert.deepEqual(textGroup(tokens, 4, 'line'), { anchor: 0, focus: 4 });
  assert.equal(textDocument(result, hash, engine).id, doc.id);
  assert.equal(textDocument(result, hash, engine).blocks[0].lines[0].tokens[0].id, tokens[0].id);
  assert.equal(tokens[5].sourceStart, result.text.indexOf('第'));
  assert.equal(textVertical(tokens, 1, 1), 6);
  assert.equal(textVertical(tokens, 6, -1), 1);
});
test('unaligned symbols fall back to a real word box and retain readable ordering', () => {
  const result = sample();
  result.words[0].symbols![0].text = 'X';
  const tokens = readingTokens(textDocument(result, hash, engine));
  assert.equal(tokens[0].text, 'One');
  assert.equal(tokens[0].geometry, 'word');
  result.text = 'Different source';
  const doc = textDocument(result, hash, engine);
  assert.equal(doc.alignment, 'reconstructed');
  assert.match(selectedText(readingTokens(doc), 0, 100), /^One 文字\n第二行\nRight$/);
  assert.equal(selectedText(tokens, -1, 1), '');
});
test('glyph validation rejects malformed, out-of-image, excess and non-finite boxes', () => {
  for (const change of [{ x: -1 }, { height: 101 }, { confidence: NaN }, { width: 0.5 }, { text: 'a'.repeat(65) }]) {
    const result = sample(); Object.assign(result.words[0].symbols![0], change);
    assert.throws(() => ocrResult(result, result, result.language), /字形/);
  }
});
test('selection geometry round trips all quarter turns, zoom/DPI scales and skewed quads', () => {
  for (const rotation of [0, 1, 2, 3] as TextRotation[]) for (const scale of [0.25, 1, 1.25, 1.5, 2.75]) {
    const view = { width: 400, height: 900, scale, rotation };
    for (const point of [{ x: 0, y: 0 }, { x: 37.5, y: 180.25 }, { x: 400, y: 900 }]) {
      const mapped = textViewToImage(imageToTextView(point, view), view);
      assert.ok(Math.abs(mapped.x - point.x) < 1e-9 && Math.abs(mapped.y - point.y) < 1e-9);
    }
    const size = textViewSize(view);
    assert.equal(size.width, (rotation % 2 ? 900 : 400) * scale);
  }
  const quad: TextQuad = [{ x: 10, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 30 }, { x: 0, y: 20 }];
  assert.equal(insideTextQuad({ x: 15, y: 15 }, quad), true);
  assert.equal(insideTextQuad({ x: 0, y: 0 }, quad), false);
});
