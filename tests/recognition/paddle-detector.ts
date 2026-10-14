import test from 'node:test';
import assert from 'node:assert/strict';
import { paddleDetBoxes, paddleDetConfig, paddleDetInput, mergePaddleTextBoxes, type PaddleTextBox } from '../../src/main/recognition/paddle-detector';
import { rectifyPaddleText } from '../../src/main/recognition/paddle-pipeline';
import {paddleTextRows} from '../../src/main/recognition/paddle-detector';
const config = paddleDetConfig(`Global: {model_name: fixture}
PreProcess:
  transform_ops:
    - DecodeImage: {img_mode: BGR}
    - NormalizeImage: {mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: '1./255.'}
PostProcess: {name: DBPostProcess, thresh: 0.2, box_thresh: 0.4, unclip_ratio: 1.4, max_candidates: 3000}`);
test('DB postprocessing keeps separate lines, scores whole boxes and unclips in original coordinates', () => {
  const map = new Float32Array(100 * 100);
  for (const y of [10, 40]) for (let row = y; row < y + 10; row++) for (let x = 10; x < 80; x++) map[row * 100 + x] = 0.9;
  const result = paddleDetBoxes(map, [1, 1, 100, 100], 200, 300, config);
  assert.equal(result.boxes.length, 2);
  assert.ok(result.boxes.every(box => box.quad[0].x < 20 && box.quad[1].x > 158 && box.confidence > 0.89));
  assert.equal(result.truncated, false);
  map[0] = NaN; assert.throws(() => paddleDetBoxes(map, [1, 1, 100, 100], 200, 300, config), /概率/);
});
test('detector normalizes BGR and bounds resize before rounding to the model stride', () => {
  const input = paddleDetInput(Uint8Array.from([255, 128, 0]), 1, 1, config, 32, 64);
  assert.deepEqual(input.dims, [1, 3, 32, 32]);
  assert.ok(Math.abs(input.data[0] - (0 - 0.485) / 0.229) < 1e-6);
  assert.ok(Math.abs(input.data[2048] - (1 - 0.406) / 0.225) < 1e-6);
});
test('perspective crop retains corner correspondence and rotates a tall crop without scaling its source coordinates', () => {
  const rgb = new Uint8Array(10 * 10 * 3);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { rgb[(y * 10 + x) * 3] = x * 10; rgb[(y * 10 + x) * 3 + 1] = y * 10; }
  const crop = rectifyPaddleText(rgb, 10, 10, [{ x: 1, y: 1 }, { x: 8, y: 2 }, { x: 7, y: 8 }, { x: 2, y: 7 }]);
  assert.deepEqual([...crop.data.slice(0, 3)], [10, 10, 0]);
  assert.deepEqual([...crop.data.slice(-3)], [70, 80, 0]);
  const tall = rectifyPaddleText(rgb, 10, 10, [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 9 }, { x: 1, y: 9 }]);
  assert.deepEqual([tall.width, tall.height], [8, 2]);
});
test('mixed-height fragments on one baseline read left-to-right without joining adjacent rows',()=>{
  const box=(x:number,y:number,w:number,h:number)=>({confidence:.9,quad:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}] as import('../../src/shared/recognition/text-document').TextQuad});
  const left=box(21,20,174,46),right=box(183,9,330,66),next=box(20,90,200,24);
  assert.deepEqual(paddleTextRows([right,next,left]),[[left,right],[next]]);
});
test('expanded collinear pieces merge geometrically without guessing/deduplicating text or joining separate rows', () => {
  const box = (x: number, y: number, width: number): PaddleTextBox => ({ confidence: 0.9,
    quad: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + 20 }, { x, y: y + 20 }] });
  const result = mergePaddleTextBoxes([box(0, 0, 100), box(90, 0, 60), box(160, 0, 50), box(0, 40, 100)], 300, 100);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].quad, [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 20 }, { x: 0, y: 20 }]);
});
