import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLayerLayout } from '../../src/shared/capture/capture-layout';
import {
  captureDesktopFrames,
  desktopSignature,
  type DesktopMonitor,
  type DesktopFrameSource,
} from '../../src/main/capture/capture-desktop-frames';
test('desktop layout uses physical pixels, negative origins and gaps without applying DIP scale again', () => {
  const monitors: DesktopMonitor[] = [
      {
        id: 2,
        name: '125%',
        signature: '125%-rotation0',
        bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
      },
      {
        id: 1,
        name: '150%',
        signature: '150%-rotation0',
        bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      },
    ],
    layout = captureLayerLayout(monitors.map((m) => m.bounds));
  assert.deepEqual([layout.x, layout.y, layout.width, layout.height], [-1920, -200, 4480, 1640]);
  assert.deepEqual(layout.layers[1], { x: 1920, y: 200, width: 2560, height: 1440 });
  assert.equal(desktopSignature(monitors), desktopSignature([...monitors].reverse()));
  assert.notEqual(
    desktopSignature(monitors),
    desktopSignature(monitors.map((m) => ({ ...m, signature: 'rotated' }))),
  );
  assert.equal(
    captureLayerLayout(
      Array.from({ length: 9 }, (_, i) => ({ x: i * 10, y: 0, width: 10, height: 10 })),
    ).width,
    90,
  );
  assert.throws(() => captureLayerLayout([{ x: 0, y: 0, width: 10000, height: 5000 }]), /像素/);
  assert.throws(() => desktopSignature([monitors[0], monitors[0]]), /列表/);
});
test('whole desktop capture is complete or rejected on changed displays, dimensions, source failure and cancellation', async () => {
  const base: DesktopMonitor[] = [
    { id: 2, name: 'Right', signature: '150%', bounds: { x: 0, y: 20, width: 200, height: 100 } },
    { id: 1, name: 'Left', signature: '125%', bounds: { x: -100, y: 0, width: 100, height: 100 } },
  ];
  let captured = 0,
    stopped = 0,
    changed = false,
    mismatch = false,
    fail = false;
  const source: DesktopFrameSource = {
    list: () => base.filter((_, i) => !(changed && captured && i === 0)),
    create: (bounds) => ({
      frame: async (fresh) => {
        assert.equal(fresh, true);
        captured++;
        if (fail && captured === 2) throw Error('monitor failed');
        const png = Buffer.alloc(24);
        png[0] = captured;
        png.writeUInt32BE(bounds.width + (mismatch ? 1 : 0), 16);
        png.writeUInt32BE(bounds.height, 20);
        return png;
      },
      stop: () => {
        stopped++;
      },
    }),
  };
  const result = await captureDesktopFrames(source, new AbortController().signal);
  assert.deepEqual(result.physical, { x: -100, y: 0, width: 300, height: 120 });
  assert.deepEqual(
    result.layers.map((s) => [s.name, s.x, s.y, s.png[0]]),
    [
      ['Left', 0, 0, 1],
      ['Right', 100, 20, 2],
    ],
  );
  assert.equal(stopped, 2);
  for (const reason of ['changed', 'mismatch', 'failure']) {
    changed = reason === 'changed';
    mismatch = reason === 'mismatch';
    fail = reason === 'failure';
    captured = stopped = 0;
    await assert.rejects(captureDesktopFrames(source, new AbortController().signal));
    assert.equal(stopped, mismatch ? 1 : 2, reason);
  }
  const abort = new AbortController();
  let rejectFrame: (error: Error) => void = () => {};
  const pending = captureDesktopFrames(
    {
      list: () => base,
      create: () => ({
        frame: () =>
          new Promise<Buffer>((_accept, reject) => {
            rejectFrame = reject;
          }),
        stop: () => rejectFrame(Error('desktop cancelled')),
      }),
    },
    abort.signal,
  );
  abort.abort();
  await assert.rejects(pending, /cancelled/);
});
