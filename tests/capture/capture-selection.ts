import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectionMask,
  maskBounds,
  maskContains,
  remapSelectionMask,
  SELECTION_POINTS,
} from '../../src/shared/capture/capture-selection';
import { ImageHistory, transformImage, validateImageDocument } from '../../src/shared/capture/image-document';
import {
  captureWindowLayout,
  arrangeWindows,
  windowPlacements,
} from '../../src/shared/capture/capture-window-layout';
import { captureWindowFrames, type WindowFrameSource } from '../../src/main/capture/capture-window-frames';

test('shaped selection history preserves bounded contour geometry through move, resize and transforms', () => {
  const history = new ImageHistory(500, 300, false),
    mask = selectionMask(
      {
        kind: 'polygon',
        points: [
          { x: 10, y: 20 },
          { x: 210, y: 20 },
          { x: 10, y: 120 },
        ],
      },
      500,
      300,
    ),
    bounds = maskBounds(mask.points);
  history.commit({ ...history.value, selection: bounds, selectionMask: mask });
  const moved = { x: 100, y: 50, width: 300, height: 200 };
  history.commit({
    ...history.value,
    selection: moved,
    selectionMask: remapSelectionMask(mask, bounds, moved),
  });
  assert.equal(maskContains(history.value.selectionMask!, { x: 120, y: 70 }), true);
  assert.equal(maskContains(history.value.selectionMask!, { x: 380, y: 230 }), false);
  history.undo();
  assert.deepEqual(history.value.selectionMask, mask);
  history.redo();
  assert.deepEqual(history.value.selection, moved);
  for (const kind of ['rotate', 'flipX', 'flipY', 'crop'] as const) {
    const transformed = transformImage(history.value, kind, moved);
    assert.deepEqual(validateImageDocument(transformed, history.value.original), transformed);
    assert.deepEqual(transformed.selection, maskBounds(transformed.selectionMask!.points));
  }
  assert.throws(
    () => validateImageDocument({ ...history.value, selection: bounds }, history.value.original),
    /不符/,
  );
  for (const points of [
    [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 8, y: 8 },
    ],
    [
      { x: -1, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ],
    Array(SELECTION_POINTS + 1).fill({ x: 1, y: 1 }),
  ])
    assert.throws(() => selectionMask({ kind: 'free', points }, 500, 300), /选区/);
  const crossed = selectionMask(
    {
      kind: 'free',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 100, y: 0 },
      ],
    },
    500,
    300,
  );
  assert.equal(maskContains(crossed, { x: 50, y: 10 }), true);
  assert.equal(maskContains(crossed, { x: 10, y: 50 }), false);
  const clipped = transformImage(history.value, 'crop', { x: 120, y: 70, width: 100, height: 100 });
  assert.deepEqual(clipped.selection, { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(maskContains(clipped.selectionMask!, { x: 10, y: 10 }), true);
});
test('window layout preserves physical positions and layer order within shared input and output budgets', () => {
  const windows = [
      { x: -200, y: -40, width: 300, height: 200 },
      { x: 0, y: 0, width: 100, height: 100 },
    ],
    plan = captureWindowLayout(windows);
  assert.deepEqual([plan.width, plan.height], [300, 200]);
  assert.deepEqual(plan.layers[1], { x: 200, y: 40, width: 100, height: 100 });
  assert.deepEqual(captureWindowLayout([...windows].reverse()).layers[0], plan.layers[1]);
  assert.throws(() => captureWindowLayout(Array(9).fill(windows[0])), /1–8/);
  assert.throws(() => captureWindowLayout([{ ...windows[0], width: 20000 }]), /像素/);
  assert.throws(
    () => captureWindowLayout([{ x: -20000, y: 0, width: 100, height: 100 }, windows[1]]),
    /像素/,
  );
  assert.throws(
    () => captureWindowLayout(Array(5).fill({ x: 0, y: 0, width: 3000, height: 3000 })),
    /总量/,
  );
});
test('independent window capture rejects changed identities, moved windows, failures and cancellation without partial snapshots', async () => {
  const choices = [
    { hwnd: 1, pid: 11, name: 'Bottom' },
    { hwnd: 2, pid: 22, name: 'Top' },
  ];
  let stopped = 0,
    captured = 0,
    changed = false,
    fail = false,
    move = false;
  const source: WindowFrameSource = {
    ownPid: 99,
    info: (hwnd) => ({
      hwnd,
      pid: changed && captured ? 88 : hwnd * 11,
      x: hwnd === 1 ? -100 : 0,
      y: move && captured ? 10 : 0,
      width: 200,
      height: 100,
    }),
    create: () => ({
      frame: async () => {
        captured++;
        if (fail && captured === 2) throw Error('capture failed');
        const png = Buffer.alloc(24);
        png[0] = captured;
        png.writeUInt32BE(200, 16);
        png.writeUInt32BE(100, 20);
        return png;
      },
      stop: () => {
        stopped++;
      },
    }),
  };
  const result = await captureWindowFrames(choices, new AbortController().signal, source);
  assert.deepEqual(
    result.layers.map((s) => [s.name, s.x, s.png[0]]),
    [
      ['Bottom', 0, 1],
      ['Top', 100, 2],
    ],
  );
  assert.equal(stopped, 2);
  for (const reason of ['identity', 'move', 'frame']) {
    changed = reason === 'identity';
    move = reason === 'move';
    fail = reason === 'frame';
    captured = stopped = 0;
    await assert.rejects(captureWindowFrames(choices, new AbortController().signal, source));
    assert.equal(stopped, 2, reason);
  }
  const abort = new AbortController();
  let rejectFrame: (error: Error) => void = () => {};
  const pending = captureWindowFrames(choices, abort.signal, {
    ...source,
    info: (hwnd) => ({ hwnd, pid: hwnd * 11, x: 0, y: 0, width: 200, height: 100 }),
    create: () => ({
      frame: () =>
        new Promise<Buffer>((_accept, reject) => {
          rejectFrame = reject;
        }),
      stop: () => rejectFrame(Error('cancelled')),
    }),
  });
  abort.abort();
  await assert.rejects(pending, /cancelled/);
});

test('free window placements preserve physical sizes and layer order independently of desktop positions', async () => {
  const choices = [
    { hwnd: 1, pid: 11, name: '底层' },
    { hwnd: 2, pid: 22, name: '顶层' },
  ];
  const source: WindowFrameSource = {
    ownPid: 99,
    info: (hwnd) => ({ hwnd, pid: hwnd * 11, x: hwnd * 100, y: 0, width: 200, height: 100 }),
    create: () => ({
      frame: async () => {
        const png = Buffer.alloc(24);
        png.writeUInt32BE(200, 16);
        png.writeUInt32BE(100, 20);
        return png;
      },
      stop: () => {},
    }),
  };
  const placements = windowPlacements(
    [
      { token: 'one', x: 340, y: -20 },
      { token: 'two', x: 40, y: 30 },
    ],
    ['one', 'two'],
  );
  const result = await captureWindowFrames(
    choices,
    new AbortController().signal,
    source,
    placements,
  );
  assert.deepEqual([result.width, result.height], [500, 150]);
  assert.deepEqual(
    result.layers.map((item) => [item.name, item.x, item.y, item.width, item.height]),
    [
      ['底层', 300, 0, 200, 100],
      ['顶层', 0, 50, 200, 100],
    ],
  );
  assert.throws(() => windowPlacements([{ token: 'two', x: 0, y: 0 }], ['one']), /布局/);
  assert.throws(() => windowPlacements([{ token: 'one', x: Infinity, y: 0 }], ['one']), /布局/);
});
test('smart window arrangement has no overlaps and never rescales windows', () => {
  const originals = [
    { x: 200, y: -90, width: 480, height: 320 },
    { x: -600, y: 30, width: 700, height: 500 },
    { x: 0, y: 0, width: 320, height: 900 },
  ];
  const arranged = arrangeWindows(originals);
  assert.deepEqual(
    arranged.map((item) => [item.width, item.height]),
    originals.map((item) => [item.width, item.height]),
  );
  for (let a = 0; a < arranged.length; a++)
    for (let b = a + 1; b < arranged.length; b++) {
      const first = arranged[a],
        second = arranged[b];
      assert.ok(
        first.x + first.width <= second.x ||
          second.x + second.width <= first.x ||
          first.y + first.height <= second.y ||
          second.y + second.height <= first.y,
      );
    }
});
