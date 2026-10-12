import test from 'node:test';
import assert from 'node:assert/strict';
import { ocrDimensions, ocrLanguage, ocrResult, ocrText, OCR_TEXT } from '../../src/shared/recognition/ocr';
import { actionList } from '../../src/shared/capture/capture-workflow';
import { captureRequest } from '../../src/shared/capture/capture-session';
import { defaultEffects } from '../../src/shared/capture/image-output';

test('OCR validates its bounded languages, dimensions, text and word coordinates', () => {
  assert.equal(ocrLanguage('chi_sim+eng'), 'chi_sim+eng');
  for (const value of ['https://other/model', '../eng', {}, null])
    assert.throws(() => ocrLanguage(value));
  for (const [w, h] of [
    [0, 1],
    [1.1, 2],
    [8193, 1],
    [4000, 4000],
  ])
    assert.throws(() => ocrDimensions(w, h));
  assert.throws(() => ocrText('a'.repeat(OCR_TEXT + 1)));
  const size = { width: 100, height: 100 },
    word = { text: 'One', confidence: 91, x: 10, y: 20, width: 40, height: 20, line: 0 };
  const result = { ...size, language: 'eng', text: 'One', confidence: 91, words: [word] };
  assert.deepEqual(ocrResult(result, size, 'eng').words, [word]);
  for (const change of [
    { x: -1 },
    { width: 101 },
    { line: 0.1 },
    { confidence: NaN },
    { text: 'a'.repeat(4097) },
  ])
    assert.throws(() => ocrResult({ ...result, words: [{ ...word, ...change }] }, size, 'eng'));
  assert.throws(() => ocrResult({ ...result, language: 'chi_sim+eng' }, size, 'eng'));
  assert.throws(() => ocrResult({ ...result, width: 99 }, size, 'eng'));
  assert.deepEqual(actionList(['copy', 'save', 'pin', 'library', 'ocr']), [
    'copy',
    'save',
    'pin',
    'library',
    'ocr',
  ]);
  assert.throws(() => actionList(['ocr', 'ocr']));
  assert.equal(
    captureRequest(
      {
        token: 't',
        selection: { x: 0, y: 0, width: 100, height: 100 },
        png: 'x',
        effects: defaultEffects(),
        actions: ['copy', 'save', 'pin', 'library', 'ocr'],
      },
      't',
      100,
      100,
      false,
    ).actions.length,
    5,
  );
});
