import test from 'node:test';
import assert from 'node:assert/strict';
import { paddleOrientationConfig, paddleOrientationInput, paddleOrientationResult } from '../../src/main/recognition/paddle-orientation';
const yaml = `Global: {model_name: PP-LCNet_x1_0_textline_ori}
PreProcess:
  transform_ops:
    - ResizeImage: {size: [160, 80]}
    - NormalizeImage: {channel_num: 3, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], order: '', scale: 0.00392156862745098}
    - ToCHWImage: null
PostProcess: {Topk: {topk: 1, label_list: [0_degree, 180_degree]}}`;
test('textline orientation uses official RGB normalization and guards incompatible preprocessing', () => {
  const config = paddleOrientationConfig(yaml), input = paddleOrientationInput(Uint8Array.from([255, 128, 0]), 1, 1, config), pixels = 160 * 80;
  assert.deepEqual(input.dims, [1, 3, 80, 160]);
  assert.ok(Math.abs(input.data[0] - (1 - .485) / .229) < 1e-6);
  assert.ok(Math.abs(input.data[pixels] - (128 / 255 - .456) / .224) < 1e-6);
  assert.ok(Math.abs(input.data[pixels * 2] + .406 / .225) < 1e-6);
  assert.throws(() => paddleOrientationConfig(yaml.replace('scale: 0.00392156862745098', 'unknown: 1')));
  assert.throws(() => paddleOrientationConfig(yaml.replace('[160, 80]', '[224, 224]')));
  assert.throws(() => paddleOrientationConfig(yaml.replace('[0_degree, 180_degree]', '[180_degree, 0_degree]')));
  assert.throws(() => paddleOrientationInput(new Uint8Array(2), 1, 1, config));
});
test('orientation maps only verified two-class probability output to 0/180 degrees', () => {
  assert.equal(paddleOrientationResult(Float32Array.from([.1, .9]), [1, 2]).rotation, 180);
  assert.equal(paddleOrientationResult(Float32Array.from([.9, .1]), [1, 2]).rotation, 0);
  assert.equal(paddleOrientationResult(Float32Array.from([.5, .5]), [1, 2]).rotation, 0);
  assert.throws(() => paddleOrientationResult(Float32Array.from([1, 1]), [1, 2]));
  assert.throws(() => paddleOrientationResult(Float32Array.from([NaN, 0]), [1, 2]));
  assert.throws(() => paddleOrientationResult(Float32Array.from([.1, .9]), [2]));
});
