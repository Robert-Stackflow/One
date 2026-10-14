import test from 'node:test';
import assert from 'node:assert/strict';
import {ScrollStitch} from '../../src/shared/capture/scroll-stitch';
import {ScrollSettle} from '../../src/shared/capture/scroll-settle';
import {scrollDefaults} from '../../src/shared/capture/scroll-capture';
import {NativePixelReader,FRAME_PIXEL_LIMIT} from '../../src/shared/capture/native-pixels';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';

test('native packed pixels survive arbitrary pipe splits and reject invalid layouts before allocation',()=>{
  const info={version:1,format:'bgra8',backend:'wgc',width:4,height:3,stride:16,bytes:48,elapsed:12},pixels=Buffer.from(Array.from({length:48},(_,i)=>i)),bytes=Buffer.concat([Buffer.from(JSON.stringify(info)+'\n'),pixels]);
  for(const split of [1,7,37,512]){const reader=new NativePixelReader();for(let at=0;at<bytes.length;at+=split)reader.append(bytes.subarray(at,at+split));assert.equal(reader.complete,true);const value=reader.finish();assert.deepEqual(Buffer.from(value.frame.pixels),pixels);assert.equal(value.frame.pixels.buffer.byteLength,48);reader.clear();assert.ok(value.frame.pixels.every(byte=>byte===0));}
  for(const change of [{version:2},{format:'rgba8'},{stride:20},{bytes:47},{bytes:FRAME_PIXEL_LIMIT+1},{elapsed:-1},{width:10001,height:1001,stride:40004,bytes:40044004}])assert.throws(()=>new NativePixelReader().append(Buffer.from(JSON.stringify({...info,...change})+'\n')),/无效/);
  assert.throws(()=>new NativePixelReader().append(Buffer.alloc(513,32)),/过大/);
  const partial=new NativePixelReader();partial.append(bytes.subarray(0,bytes.length-1));assert.throws(()=>partial.finish(),/不完整/);partial.clear();
  assert.throws(()=>new NativePixelReader().append(Buffer.concat([bytes,Buffer.from([1])])),/额外/);
});

test('worker owns transferred raw frames, commits only staged frames and skips unchanged previews',async()=>{
  const worker=new Worker(join(__dirname,'capture/scroll-worker.cjs'));let serial=0;
  const command=(kind:string,value?:unknown,transfer:ArrayBuffer[]=[])=>new Promise<any>((resolve,reject)=>{const id=++serial;worker.once('message',message=>{assert.equal(message.id,id);message.error?reject(Error(message.error)):resolve(message);});worker.postMessage({id,kind,value},transfer);});
  try{
    await command('configure',{options:scrollDefaults(),source:{width:96,height:160}});
    const frame=scrollPixels(96,160),original=frame.pixels.slice(),staging=command('stage',{frame,monitored:false},[frame.pixels.buffer as ArrayBuffer]);assert.equal(frame.pixels.byteLength,0);assert.equal((await staging).stable,true);
    const first=await command('commit');assert.equal(first.result.count,1);assert.ok(first.preview);
    const same=scrollPixels(96,160);await command('stage',{frame:same,monitored:false},[same.pixels.buffer as ArrayBuffer]);const unchanged=await command('commit');assert.equal(unchanged.result.match,'unchanged');assert.equal(unchanged.preview,null);
    const next=scrollPixels(96,160,0,39);await command('stage',{frame:next,monitored:false},[next.pixels.buffer as ArrayBuffer]);await command('release-frame');await assert.rejects(command('commit'),/已失效/);
    const output=await command('output');assert.deepEqual(output.output.pixels,original);assert.equal(output.output.height,160);
  }finally{await worker.terminate();}
});
function scrollPixels(width: number, height: number, x = 0, y = 0) {
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      let v = Math.imul(col + x + 17, 1103515245) ^ Math.imul(row + y + 31, 2654435761);
      v ^= v >>> 13;
      v = Math.imul(v, 2246822519);
      v ^= v >>> 16;
      const i = (row * width + col) * 4;
      pixels.set([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, 255], i);
    }
  return { width, height, pixels };
}
test('automatic scrolling waits for the final smooth-scroll frame before appending original pixels', () => {
  for (const axis of ['vertical', 'horizontal'] as const) {
    const vertical = axis === 'vertical',
      source = { width: vertical ? 96 : 160, height: vertical ? 160 : 96 },
      options = { ...scrollDefaults(), axis },
      engine = new ScrollStitch(),
      settle = new ScrollSettle(options, source);
    engine.configure(options, source);
    engine.sample(scrollPixels(source.width, source.height));
    const frame = (offset: number) =>
      scrollPixels(source.width, source.height, vertical ? 0 : offset, vertical ? offset : 0);
    for (const [time, offset] of [
      [0, 4],
      [140, 17],
      [280, 29],
      [420, 39],
      [560, 39],
    ]) {
      assert.equal(settle.observe(frame(offset), time), false);
      assert.equal(engine.status().count, 1, 'moving frames must never enter the stitched result');
    }
    assert.equal(settle.observe(frame(39), 700), true);
    assert.equal(engine.sample(frame(39)).offset, 39);
    assert.deepEqual(engine.output(), scrollPixels(vertical ? 96 : 199, vertical ? 199 : 96));
    settle.reset();
    assert.equal(
      settle.observe(frame(39), 800),
      false,
      'every wheel starts a fresh quiet interval',
    );
  }
});
test('scroll settling excludes configured fixed edges and tolerates a narrow changing column', () => {
  const source = { width: 120, height: 160 },
    options = { ...scrollDefaults(), trimStart: 16, trimEnd: 8, ignoreEnd: 8 },
    settle = new ScrollSettle(options, source);
  const frame = (n: number) => {
    const f = scrollPixels(source.width, source.height);
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++)
        if (y < 16 || y >= 152 || x >= 112 || x === 60)
          f.pixels.fill(n, (y * source.width + x) * 4, (y * source.width + x) * 4 + 3);
    return f;
  };
  assert.equal(settle.observe(frame(0), 0), false);
  assert.equal(settle.observe(frame(255), 140), false);
  assert.equal(settle.observe(frame(128), 280), true);
  const broad = scrollPixels(source.width, source.height, 800);
  assert.equal(settle.observe(broad, 420), false, 'a broad change resets the interval');
  assert.equal(settle.observe(broad, 560), false);
  assert.equal(settle.observe(broad, 700), true);
});
test('settling cannot confuse elapsed time, rapid duplicate samples or gradual drift with a quiet frame', () => {
  const source = { width: 96, height: 160 },
    settle = new ScrollSettle(scrollDefaults(), source),
    blank = scrollPixels(source.width, source.height);
  blank.pixels.fill(0);
  const changed = (n: number) => {
    const f = { ...blank, pixels: blank.pixels.slice() };
    for (let i = 0; i < f.pixels.length; i += 4) f.pixels[i] = n;
    return f;
  };
  assert.equal(settle.observe(blank, 0), false);
  assert.equal(settle.observe(blank, 1), false);
  assert.equal(settle.observe(blank, 2), false);
  assert.equal(settle.observe(changed(1), 140), false);
  assert.equal(
    settle.observe(changed(2), 280),
    false,
    'compare to the interval anchor, not just the previous sample',
  );
  assert.equal(settle.observe(changed(2), 420), false);
  assert.equal(settle.observe(changed(2), 560), true);
  assert.throws(() => settle.observe(blank, 500), /时间/);
  assert.throws(() => settle.observe(blank, NaN), /时间/);
  assert.throws(() => settle.observe(scrollPixels(95, 160), 700), /尺寸/);
});
test('continuous animation never becomes a stable scroll frame and resetting releases the old anchor', () => {
  const settle = new ScrollSettle(scrollDefaults(), { width: 96, height: 160 });
  for (let i = 0; i < 30; i++)
    assert.equal(settle.observe(scrollPixels(96, 160, i * 13, i * 7), i * 140), false);
  settle.reset();
  const final = scrollPixels(96, 160, 100);
  assert.equal(settle.observe(final, 0), false);
  assert.equal(settle.observe(final, 140), false);
  assert.equal(settle.observe(final, 280), true);
});
test('scrolling capture preserves exact pixels across irregular vertical and horizontal overlaps, undo and backtracking', () => {
  for (const axis of ['vertical', 'horizontal'] as const) {
    const engine = new ScrollStitch(),
      vertical = axis === 'vertical',
      source = { width: vertical ? 96 : 160, height: vertical ? 160 : 96 };
    engine.configure({ ...scrollDefaults(), axis }, source);
    engine.sample(scrollPixels(source.width, source.height));
    for (const offset of [37, 89, 141]) {
      const status = engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : offset, vertical ? offset : 0),
      );
      assert.equal(status.match, 'accepted');
      assert.equal(status.offset, offset === 37 ? 37 : 52);
    }
    assert.equal(
      engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : 141, vertical ? 141 : 0),
      ).match,
      'unchanged',
    );
    assert.equal(
      engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : 120, vertical ? 120 : 0),
      ).match,
      'backwards',
    );
    const actual = engine.output();
    assert.deepEqual(actual, scrollPixels(vertical ? 96 : 301, vertical ? 301 : 96));
    const undone = engine.undo();
    assert.equal(undone.count, 3);
    assert.deepEqual(engine.output(), scrollPixels(vertical ? 96 : 249, vertical ? 249 : 96));
    assert.equal(
      engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : 141, vertical ? 141 : 0),
      ).match,
      'accepted',
    );
    assert.deepEqual(engine.output(), actual);
    assert.ok(engine.preview()!.width <= 300 && engine.preview()!.height <= 700);
  }
});
test('scrolling capture removes explicit fixed edges and ignores a dynamic side while preserving remaining pixels', () => {
  const engine = new ScrollStitch(),
    source = { width: 96, height: 184 };
  engine.configure({ ...scrollDefaults(), trimStart: 16, trimEnd: 8, ignoreEnd: 8 }, source);
  const frame = (offset: number, animate: number) => {
    const body = scrollPixels(96, 160, 0, offset),
      result = new Uint8Array(96 * 184 * 4);
    result.set(body.pixels, 96 * 16 * 4);
    for (let y = 16; y < 176; y++)
      for (let x = 88; x < 96; x++) result.fill(animate, (y * 96 + x) * 4, (y * 96 + x + 1) * 4);
    return { ...source, pixels: result };
  };
  engine.sample(frame(0, 10));
  assert.equal(engine.sample(frame(47, 200)).match, 'accepted');
  const output = engine.output(),
    expected = scrollPixels(96, 207);
  for (let y = 0; y < 207; y++)
    assert.deepEqual(
      output.pixels.slice(y * 96 * 4, (y * 96 + 88) * 4),
      expected.pixels.slice(y * 96 * 4, (y * 96 + 88) * 4),
    );
  assert.equal(output.height, 207);
});
test('uncertain scrolling content requires explicit join, rejected dimensions preserve the last usable result', () => {
  const engine = new ScrollStitch();
  engine.configure(scrollDefaults(), { width: 96, height: 160 });
  engine.sample(scrollPixels(96, 160));
  const before = engine.output();
  const unrelated = scrollPixels(96, 160, 999, 777);
  assert.equal(engine.sample(unrelated).match, 'ambiguous');
  assert.deepEqual(engine.output(), before);
  assert.throws(() => engine.sample(unrelated), /上一帧/);
  assert.throws(() => engine.join(159), /位移/);
  assert.equal(engine.join(40).count, 2);
  assert.equal(engine.output().height, 200);
  engine.undo();
  assert.deepEqual(engine.output(), before);
  assert.throws(() => engine.sample(scrollPixels(90, 160)), /尺寸/);
  assert.deepEqual(engine.output(), before);
  assert.throws(
    () => engine.configure({ ...scrollDefaults(), trimStart: 120 }, { width: 96, height: 160 }),
    /64/,
  );
});
test('repeating scrolling patterns do not turn an equally plausible overlap into an automatic join', () => {
  const engine = new ScrollStitch();
  engine.configure(scrollDefaults(), { width: 80, height: 160 });
  const repeated = (offset: number) => {
    const frame = scrollPixels(80, 160);
    for (let y = 0; y < 160; y++)
      frame.pixels.set(scrollPixels(80, 1, 0, (y + offset) % 24).pixels, y * 80 * 4);
    return frame;
  };
  engine.sample(repeated(0));
  const before = engine.output(),
    status = engine.sample(repeated(17));
  assert.equal(status.match, 'ambiguous');
  assert.equal(status.pending, true);
  assert.deepEqual(engine.output(), before);
});
