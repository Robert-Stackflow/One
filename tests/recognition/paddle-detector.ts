import test from 'node:test';
import assert from 'node:assert/strict';
import { paddleDetBoxes, paddleDetConfig, paddleDetInput, mergePaddleTextBoxes, type PaddleTextBox } from '../../src/main/recognition/paddle-detector';
import { rectifyPaddleText } from '../../src/main/recognition/paddle-pipeline';
import {paddleTextRows} from '../../src/main/recognition/paddle-detector';
import {paddleDetectionDimensions,paddleDetectionTiles,PADDLE_DETECTION_PIXELS} from '../../src/shared/recognition/paddle-dimensions';
import {planOCRTiles} from '../../src/shared/recognition/ocr-tiles';
const config = paddleDetConfig(`Global: {model_name: fixture}
PreProcess:
  transform_ops:
    - DecodeImage: {img_mode: BGR}
    - NormalizeImage: {mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: '1./255.'}
PostProcess: {name: DBPostProcess, thresh: 0.2, box_thresh: 0.4, unclip_ratio: 1.4, max_candidates: 3000}`);

test('detector capacity is checked after stride rounding and follows the selected preset resize',()=>{
  assert.deepEqual(paddleDetectionDimensions({width:2000,height:2000}),{width:2016,height:2016});
  assert.equal(paddleDetectionTiles({width:2000,height:2000}).forceTiles,true);
  assert.equal(paddleDetectionTiles({width:1999,height:1999}).forceTiles,false);
  assert.equal(paddleDetectionTiles({width:1984,height:1984}).forceTiles,false);
  for(const size of [{width:2400,height:3435},{width:2550,height:3506},{width:3024,height:2268}]){
    const policy=paddleDetectionTiles(size);assert.equal(policy.forceTiles,true);
    for(const tile of planOCRTiles(size,policy.tileEdge)){const normalized=paddleDetectionDimensions(tile);assert.ok(normalized.width*normalized.height<=PADDLE_DETECTION_PIXELS);}
    assert.equal(paddleDetectionTiles(size,960).forceTiles,false);
    const normalized=paddleDetectionDimensions(size,960);assert.ok(normalized.width<=1024&&normalized.height<=1024);
  }
  for(const width of [1,32,400,735,736,1000,1984])for(const height of [1,32,400,735,736,1000,1984]){
    const normalized=paddleDetectionDimensions({width,height});assert.ok(normalized.width*normalized.height<=PADDLE_DETECTION_PIXELS);
  }
  for(const size of [{width:NaN,height:100},{width:0,height:100},{width:16385,height:100},{width:8000,height:8000}])assert.throws(()=>paddleDetectionDimensions(size));
});
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
test('v5 long-side resize follows PaddleX stride 128 for landscape, portrait and large input',()=>{
  const v5={...config,resizeLong:960};
  for(const [width,height,w,h] of [[680,120,1024,256],[120,680,256,1024],[1920,1080,1024,640],[100,100,1024,1024],[1000,1,1024,128]]){
    const input=paddleDetInput(new Uint8Array(width*height*3),width,height,v5);
    assert.deepEqual(input.dims,[1,3,h,w]);
  }
  assert.throws(()=>paddleDetInput(new Uint8Array(3),1,1,{...v5,resizeLong:NaN}),/缩放/);
  const yaml=`Global: {model_name: fixture}
PreProcess:
  transform_ops:
    - DecodeImage: {img_mode: BGR}
    - DetResizeForTest: {resize_long: 960}
    - NormalizeImage: {mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: '1./255.'}
PostProcess: {name: DBPostProcess, thresh: 0.2, box_thresh: 0.4, unclip_ratio: 1.4, max_candidates: 3000}`;
  assert.equal(paddleDetConfig(yaml).resizeLong,960);
  assert.throws(()=>paddleDetConfig(yaml.replace('resize_long: 960','limit_side_len: 960')),/缩放/);
  assert.throws(()=>paddleDetConfig(yaml.replace('resize_long: 960','resize_long: -1')),/缩放/);
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
