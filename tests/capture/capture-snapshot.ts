import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeCaptureSnapshot, checkSnapshotRefresh } from '../../src/main/capture/capture-snapshot';
import { captureWindowFrames, type WindowFrameSource } from '../../src/main/capture/capture-window-frames';

function frame(width = 100, height = 60) {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}
const choices = [1, 2].map(hwnd => ({ hwnd, pid: hwnd * 10, name: 'same title' }));
const info = (hwnd: number) => ({ hwnd, pid: hwnd * 10, x: hwnd * 100, y: 0, width: 100, height: 60 });

test('completed layers survive earlier source closure and movement during later acquisition', async () => {
  let captured = 0;
  const source: WindowFrameSource = {
    ownPid: 99,
    info: hwnd => captured === 2 && hwnd === 1 ? null : { ...info(hwnd), y: captured ? 500 : 0 },
    create: () => ({ frame: async () => { captured++; return frame(); }, stop() {} }),
  };
  const result = await captureWindowFrames(choices, new AbortController().signal, source);
  assert.equal(captured, 2);
  assert.deepEqual(result.layers.map(layer => [layer.x, layer.y]), [[0, 0], [100, 0]]);
});

test('resize gets one bounded retry and persistent resize fails without leaking readers', async () => {
  for (const persistent of [false, true]) {
    let reads = 0, captured = 0, stopped = 0;
    const source: WindowFrameSource = {
      ownPid: 99,
      info: hwnd => ({ ...info(hwnd), width: persistent ? 100 + reads++ : reads++ < 2 ? 100 : 120 }),
      create: () => ({ frame: async () => { captured++; return frame(120); }, stop() { stopped++; } }),
    };
    const pending = captureWindowFrames([choices[0]], new AbortController().signal, source);
    if (persistent) await assert.rejects(pending, /尺寸持续改变/);
    else assert.equal((await pending).width, 120);
    assert.equal(captured, 2);
    assert.equal(stopped, 2);
  }
});

test('closed, minimized, reused HWND/PID and One windows fail before a wrong image is captured', async () => {
  for (const invalid of [null, { ...info(1), pid: 42 }, { ...info(1), hwnd: 42 }, { ...info(1), pid: 99 }]) {
    await assert.rejects(captureWindowFrames([choices[0]], new AbortController().signal, {
      ownPid: 99, info: () => invalid,
      create: () => { throw Error('must not acquire'); },
    }), /关闭或最小化/);
  }
});

test('stale-sized native frames are retried once and never published as a new snapshot', async () => {
  let reads = 0, stopped = 0;
  await assert.rejects(captureWindowFrames([choices[0]], new AbortController().signal, {
    ownPid: 99, info,
    create: () => ({ frame: async () => { reads++; return frame(120); }, stop() { stopped++; } }),
  }), /帧尺寸不符/);
  assert.equal(reads, 2);
  assert.equal(stopped, 2);
});

test('snapshot metadata is immutable; source/display changes are independent from offline pixels', () => {
  const layer = { png: frame(), name: 'one', x: 0, y: 0, width: 100, height: 60 };
  const original = { size: { width: 100, height: 60 }, png: layer.png, layers: [layer],
    composition: 'windows' as const, displayId: 1, sourceId: 'set:1', signature: '125%', name: 'one', capturedAt: 1 };
  const shot = freezeCaptureSnapshot(original);
  layer.x = 40;
  original.size.width = 200;
  assert.equal(shot.layers![0].x, 0);
  assert.equal(shot.size.width, 100);
  assert.ok(Object.isFrozen(shot.size));
  assert.equal(Reflect.set(shot.size, 'width', 200), false);
  assert.doesNotThrow(() => checkSnapshotRefresh(shot, { ...shot, signature: 'disconnected', displayId: 2 }));
  assert.equal(shot.png, original.png, 'owned pixel buffers must not be needlessly copied');
  for (const changed of [
    { ...shot, size: { width: 120, height: 60 } },
    { ...shot, layers: [{ ...shot.layers![0], x: 10 }] },
    { ...shot, layers: [] },
    { ...shot, sourceId: 'set:2' },
  ]) assert.throws(() => checkSnapshotRefresh(shot, changed), /已保留原快照/);
});
