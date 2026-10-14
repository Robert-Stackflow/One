import test from 'node:test';
import assert from 'node:assert/strict';
import { paddleRecConfig, paddleRecInput, decodePaddleCTC } from '../../src/main/recognition/paddle-recognizer';
const config = `Global: {model_name: fixture}
PreProcess:
  transform_ops:
    - DecodeImage: {img_mode: BGR}
    - RecResizeImg: {image_shape: [3, 48, 320]}
PostProcess: {name: CTCLabelDecode, character_dict: [A, B]}`;
test('Paddle preprocessing verifies config, BGR channel order, normalization, width and neutral padding', () => {
  const parsed = paddleRecConfig(config);
  assert.deepEqual(parsed.characters, ['', 'A', 'B', ' ']);
  const input = paddleRecInput(Uint8Array.from([255, 128, 0]), 1, 1, parsed.shape), pixels = 48 * 320;
  assert.deepEqual(input.dims, [1, 3, 48, 320]);
  assert.equal(input.resizedWidth, 48);
  assert.equal(input.data[0], -1); assert.equal(input.data[pixels * 2], 1);
  assert.ok(Math.abs(input.data[pixels] - (128 / 127.5 - 1)) < 1e-7);
  assert.equal(input.data[100], 0);
  assert.throws(() => paddleRecInput(new Uint8Array(2), 1, 1, parsed.shape));
  for (const invalid of [config.replace('BGR', 'RGB'), config.replace('CTCLabelDecode', 'NRTRLabelDecode'), config.replace('[A, B]', '[]')])
    assert.throws(() => paddleRecConfig(invalid), /不兼容/);
});
test('CTC removes adjacent repeats, retains blank-separated repeats and reports approximate emission spans', () => {
  const characters = ['', 'A', 'B', ' '], indices = [0, 1, 1, 0, 1, 2, 0, 3];
  const values = new Float32Array(indices.length * characters.length);
  indices.forEach((index, time) => { values[time * characters.length + index] = 0.9; });
  const result = decodePaddleCTC(values, [1, indices.length, 4], characters);
  assert.equal(result.text, 'AAB ');
  assert.equal(result.alignment, 'ctc-approximate');
  assert.deepEqual(result.glyphs.map(glyph => [glyph.start, glyph.end]), [[1, 3], [4, 5], [5, 6], [7, 8]]);
  assert.throws(() => decodePaddleCTC(values, [1, indices.length, 3], characters), /字典/);
  values[0] = NaN; assert.throws(() => decodePaddleCTC(values, [1, indices.length, 4], characters), /概率/);
});
test('accepted floating-point probability tolerance cannot exceed the public confidence range',()=>{
  const result=decodePaddleCTC(new Float32Array([0,1.000001]),[1,1,2],['','A']);
  assert.equal(result.confidence,1);assert.equal(result.glyphs[0].confidence,1);
});
