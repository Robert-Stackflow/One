import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSensitive, sensitiveResult } from '../../src/shared/recognition/sensitive-api';
import { sensitiveAnnotations } from '../../src/shared/capture/sensitive-annotations';
import { ImageHistory, validateImageDocument } from '../../src/shared/capture/image-document';
import type { OCRResult } from '../../src/shared/recognition/ocr';
function recognized(lines: string[][]): OCRResult {
  return {
    width: 1200,
    height: 600,
    text: lines.flat().join(' '),
    confidence: 95,
    language: 'chi_sim+eng',
    words: lines.flatMap((words, line) =>
      words.map((text, i) => ({
        text,
        line,
        confidence: 95,
        x: 10 + i * 160,
        y: 10 + line * 35,
        width: 150,
        height: 25,
      })),
    ),
  };
}
test('sensitive OCR detects independent values and field context without returning private text', () => {
  const value = detectSensitive(
    recognized([
      ['user@example.com'],
      ['13800138000'],
      ['11010519491231002X'],
      ['4111111111111111'],
      ['姓名：', '张三'],
      ['地址：', '星光路一号'],
      ['密码：', 'Correct-Horse!'],
    ]),
  );
  assert.deepEqual(
    value.regions.map((r) => r.kind),
    ['email', 'phone', 'identifier', 'card', 'name', 'address', 'secret'],
  );
  assert.equal(value.regions[4].x, 168);
  assert.ok(!JSON.stringify(value).includes('user@'));
  assert.ok(!JSON.stringify(value).includes('Correct-Horse'));
  assert.deepEqual(
    detectSensitive(
      recognized([
        ['Call', '13800138000', 'now'],
        ['Write', 'user@example.com', 'today'],
      ]),
    ).regions.map((r) => r.kind),
    ['phone', 'email'],
  );
  assert.deepEqual(
    detectSensitive(
      recognized([['版本20261010'], ['普通文本'], ['1234567890123'], ['filename:report.png']]),
    ).regions,
    [],
  );
});
test('sensitive normalization handles split OCR digits, full width characters, labels and nearby continuation', () => {
  const value = detectSensitive(
    recognized([
      ['１ ３８', '００１３', '８０００'],
      ['邮箱：user@example.com'],
      ['Name:', 'Alice', 'Password:', 'p4ss'],
      ['地址：'],
      ['北街二号'],
    ]),
  );
  assert.deepEqual(
    value.regions.map((r) => r.kind),
    ['phone', 'email', 'name', 'secret', 'address'],
  );
  assert.equal(value.regions[0].width, 474);
  assert.equal(value.regions.filter((r) => r.kind === 'email').length, 1);
  const far = recognized([['地址：'], ['普通正文']]);
  far.words[1].y = 400;
  assert.equal(detectSensitive(far).regions.length, 0);
});
test('sensitive regions clip at image edge and reject overflow instead of applying partial results', () => {
  const edge = recognized([['13800138000']]);
  edge.words[0] = { ...edge.words[0], x: 0, y: 0, width: 1200, height: 600 };
  assert.deepEqual(detectSensitive(edge).regions[0], {
    kind: 'phone',
    x: 0,
    y: 0,
    width: 1200,
    height: 600,
  });
  const many = recognized(Array.from({ length: 101 }, () => ['13800138000']));
  many.height = 4000;
  assert.throws(() => detectSensitive(many), /100/);
  assert.throws(
    () =>
      sensitiveResult({
        width: 100,
        height: 100,
        regions: [{ x: 90, y: 0, width: 11, height: 2, kind: 'phone' }],
      }),
    /区域/,
  );
  assert.throws(
    () =>
      sensitiveResult({
        width: 100,
        height: 100,
        regions: [{ x: 0, y: 0, width: 1, height: 1, kind: '__proto__' }],
      }),
    /区域/,
  );
  const huge = recognized([['a'.repeat(16385)]]);
  assert.throws(() => detectSensitive(huge), /单行/);
});
test('sensitive redactions map output coordinates into current selection and form one editable history entry', () => {
  const history = new ImageHistory(1200, 600, true),
    before = { ...history.value, selection: { x: 80, y: 40, width: 300, height: 150 } };
  history.restore(before);
  const result = {
    width: 300,
    height: 150,
    regions: [{ kind: 'email' as const, x: 10, y: 20, width: 120, height: 25 }],
  };
  const next = sensitiveAnnotations(before, result, 'solid', () => 'redaction');
  validateImageDocument(next, before.original);
  assert.deepEqual(next.annotations[0].start, { x: 90, y: 60 });
  assert.deepEqual(next.annotations[0].end, { x: 210, y: 85 });
  assert.equal(next.annotations[0].tool, 'solid');
  assert.equal(next.annotations[0].text, '');
  assert.equal(before.annotations.length, 0);
  history.commit(next);
  history.undo();
  assert.equal(history.value.annotations.length, 0);
  history.redo();
  assert.equal(history.value.annotations.length, 1);
  assert.equal(
    sensitiveAnnotations(before, result, 'mosaic', () => 'm').annotations[0].tool,
    'mosaic',
  );
  assert.throws(() => sensitiveAnnotations(before, { ...result, width: 301 }, 'solid'), /尺寸/);
  assert.throws(
    () =>
      sensitiveAnnotations(
        { ...before, annotations: Array(300).fill(next.annotations[0]) },
        result,
        'solid',
      ),
    /标注过多/,
  );
});
