import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {CaptureProbe} from '../../src/main/capture/capture-probe';
import {NativeFrameReader,FRAME_PNG_LIMIT} from '../../src/shared/capture/native-frame';
import {captureCandidates,capturePoint,desktopCapturePoint,previewCapturePoint,stableCandidates,type CaptureCandidate} from '../../src/shared/capture/capture-detection';
import {ImageHistory,selectionFrom,resizeSelection,shiftSelection,transformImage,mappedPoint,inverted,validateImageDocument,moveAnnotation,hitAnnotation,type Annotation} from '../../src/shared/capture/image-document';
import {defaultCapturePreferences,validateCapturePreferences} from '../../src/shared/capture/settings';
import {captureRequest} from '../../src/shared/capture/capture-session';
import {defaultEffects,outputEffects,outputLayout} from '../../src/shared/capture/image-output';
import {defaultWorkflows,workflowsFrom} from '../../src/shared/capture/capture-workflow';
import {CaptureDelivery} from '../../src/main/capture/capture-delivery';
test('native single-frame stream handles arbitrary chunk splits and rejects incomplete, oversized or mismatched PNG data', async () => {
  const png = await readFile('assets/icons/one-taskbar-64.png');
  const info = {
    backend: 'wgc',
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bytes: png.length,
    elapsed: 40,
  };
  const encoded = (patch = {}) =>
    Buffer.concat([Buffer.from(JSON.stringify({ ...info, ...patch }) + '\n'), png]);
  for (const chunkSize of [1, 7, 64, 16384]) {
    const reader = new NativeFrameReader(),
      bytes = encoded();
    for (let at = 0; at < bytes.length; at += chunkSize)
      reader.append(bytes.subarray(at, at + chunkSize));
    assert.deepEqual(reader.finish(), { info, png });
  }
  const desktopReader = new NativeFrameReader();
  desktopReader.append(encoded({ backend: 'gdi' }));
  assert.deepEqual(desktopReader.finish(), { info: { ...info, backend: 'gdi' }, png });
  const partial = new NativeFrameReader();
  partial.append(encoded().subarray(0, -1));
  assert.throws(() => partial.finish(), /不完整/);
  const mismatch = new NativeFrameReader();
  mismatch.append(encoded({ width: info.width + 1 }));
  assert.throws(() => mismatch.finish(), /尺寸不符/);
  for (const patch of [
    { bytes: FRAME_PNG_LIMIT + 1 },
    { height: 50000 },
    { width: 0.5 },
    { backend: 'thumbnail' },
    { elapsed: -1 },
  ])
    assert.throws(() => new NativeFrameReader().append(encoded(patch)));
  assert.throws(() => new NativeFrameReader().append(Buffer.alloc(513, 32)), /响应头过大/);
  const extra = new NativeFrameReader();
  extra.append(encoded());
  assert.throws(() => extra.append(Buffer.from('x')), /额外数据/);
});
test('capture provider startup cancellation and blocked queries release the helper without accumulating pointer work', async () => {
  const children: ReturnType<typeof spawn>[] = [];
  const launch = (script: string) => () => {
    const child = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: 'pipe' });
    children.push(child);
    return child;
  };
  const abort = new CaptureProbe(
    () => assert.fail('cancel must not be reported as provider failure'),
    launch('setInterval(()=>{},10000)'),
  );
  const abortChild = oncePromise(children, () => abort.query({ x: 20, y: 20 }, () => {}));
  abort.close();
  assert.deepEqual(await abortChild.pending, []);
  await abortChild.closed;
  let failures = 0;
  const discovered: { rows: unknown[]; partial: boolean }[] = [];
  const blocked = new CaptureProbe(
    () => failures++,
    launch(
      `console.log(JSON.stringify({ready:true}));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const p=line.split(' '),serial=Number(p[1]),window={kind:'window',rect:{x:0,y:0,width:100,height:100}};console.log(JSON.stringify({serial,status:'window',candidates:[window]}));console.log(JSON.stringify({serial,status:'progress',candidates:[window,{kind:'element',rect:{x:10,y:10,width:30,height:30}}]}));});`,
    ),
  );
  try {
    const start = Date.now();
    const first = oncePromise(children, () =>
      blocked.query({ x: 20, y: 20 }, (rows, partial) => discovered.push({ rows, partial })),
    );
    const replaced = blocked.query({ x: 21, y: 20 }, () => {});
    const latest = blocked.query({ x: 22, y: 20 }, () => {});
    assert.equal((await first.pending)[0].kind, 'window');
    assert.deepEqual(await replaced, []);
    assert.deepEqual(await latest, []);
    await first.closed;
    assert.equal(
      discovered.at(-1)?.rows.length,
      2,
      'UIA stall must not discard earlier MSAA discoveries',
    );
    assert.ok(discovered.every((result) => result.partial));
    assert.equal(failures, 1);
    assert.ok(Date.now() - start < 2500, 'provider timeout must not freeze selection');
  } finally {
    blocked.close();
    for (const child of children) if (child.exitCode === null && !child.killed) child.kill();
  }
});
function oncePromise<T>(children: ReturnType<typeof spawn>[], start: () => Promise<T>) {
  const pending = start();
  return { pending, closed: once(children.at(-1)!, 'close') };
}
test('window capture cursor mapping fits the image inside content bounds with letterboxing and negative origins', () => {
  const viewport = { x: -1000, y: 20, width: 1000, height: 800 };
  assert.deepEqual(previewCapturePoint({ x: 1000, y: 500 }, viewport, 2000, 1000), {
    x: -500,
    y: 420,
  });
  assert.deepEqual(previewCapturePoint({ x: 0, y: 0 }, viewport, 2000, 1000), { x: -1000, y: 170 });
  assert.deepEqual(previewCapturePoint({ x: 1999, y: 999 }, viewport, 2000, 1000), {
    x: -1,
    y: 670,
  });
  assert.deepEqual(previewCapturePoint({ x: 0, y: 0 }, viewport, 500, 1000), { x: -700, y: 20 });
  assert.deepEqual(previewCapturePoint({ x: 250, y: 500 }, viewport, 500, 1000), {
    x: -500,
    y: 420,
  });
  assert.deepEqual(
    previewCapturePoint({ x: 25, y: 10 }, { x: 50, y: 70, width: 200, height: 200 }, 100, 100),
    { x: 100, y: 90 },
  );
  assert.throws(() => previewCapturePoint({ x: -1, y: 0 }, viewport, 2000, 1000));
  assert.throws(() => previewCapturePoint({ x: 2000, y: 0 }, viewport, 2000, 1000));
  assert.throws(() => previewCapturePoint({ x: 1.5, y: 0 }, viewport, 2000, 1000));
  assert.throws(() => previewCapturePoint({ x: 0, y: 0 }, { ...viewport, width: 0 }, 2000, 1000));
});
test('capture detection converts negative physical origins, clips cross-monitor windows and preserves candidate hierarchy', () => {
  const monitor = { x: -2560, y: -200, width: 2560, height: 1440 };
  const point = { x: 200, y: 100 };
  const values = [
    { kind: 'window', rect: { x: -2800, y: -250, width: 1300, height: 800 } },
    { kind: 'element', rect: { x: -2280, y: -80, width: 400, height: 100 } },
    { kind: 'element', rect: { x: -2280, y: -80, width: 400, height: 100 } },
    { kind: 'element', rect: { x: -1500, y: 500, width: 30, height: 30 } },
  ];
  assert.deepEqual(captureCandidates(values, monitor, 1280, 720, point), [
    { kind: 'element', rect: { x: 140, y: 60, width: 200, height: 50 } },
    { kind: 'window', rect: { x: 0, y: 0, width: 530, height: 375 } },
    { kind: 'screen', rect: { x: 0, y: 0, width: 1280, height: 720 } },
  ]);
  assert.deepEqual(desktopCapturePoint(point, monitor, 1280, 720), { x: -2160, y: 0 });
  assert.deepEqual(
    captureCandidates([], monitor, 1280, 720, point).map((c) => c.kind),
    ['screen'],
  );
  assert.throws(() => capturePoint({ x: 1280, y: 0 }, 1280, 720));
  assert.throws(() => capturePoint({ x: 0.1, y: 0 }, 1280, 720));
  assert.throws(() =>
    captureCandidates(
      [{ kind: 'element', rect: { x: NaN, y: 0, width: 20, height: 20 } }],
      monitor,
      1280,
      720,
      point,
    ),
  );
});
test('element candidates survive HWND-only updates and one-pixel provider jitter, but leave stale windows and bounds behind', () => {
  const window: CaptureCandidate = {
    kind: 'window',
    rect: { x: 0, y: 0, width: 1000, height: 800 },
  };
  const leaf: CaptureCandidate = {
    kind: 'element',
    rect: { x: 10, y: 10, width: 200, height: 80 },
  };
  const point = { x: 30, y: 30 };
  assert.deepEqual(
    stableCandidates([leaf, window], { point, candidates: [window], partial: true }),
    [leaf, window],
  );
  const jitter = { ...leaf, rect: { ...leaf.rect, x: 11, height: 81 } };
  assert.deepEqual(
    stableCandidates([leaf, window], { point, candidates: [jitter, window], partial: false }),
    [leaf, window],
  );
  assert.deepEqual(
    stableCandidates([leaf, window], {
      point: { x: 500, y: 500 },
      candidates: [window],
      partial: true,
    }),
    [window],
  );
  const another = { ...window, rect: { ...window.rect, x: 5 } };
  assert.deepEqual(
    stableCandidates([leaf, window], { point, candidates: [another], partial: true }),
    [another],
  );
  assert.deepEqual(
    stableCandidates([leaf, window], { point, candidates: [window], partial: false }),
    [window],
  );
});
test('capture session keeps source pixels and commits reversible gestures without mutating snapshots', () => {
  const history = new ImageHistory(1920, 1080);
  const initial = history.value;
  const selection = selectionFrom({ x: 800, y: 500 }, { x: 120, y: 60 }, 1920, 1080);
  history.commit({ ...initial, selection });
  const mark: Annotation = {
    id: 'first',
    tool: 'arrow',
    start: { x: 200, y: 100 },
    end: { x: 400, y: 300 },
    points: [],
    color: '#ff0000',
    width: 3,
    text: '',
    strength: 12,
    number: 1,
  };
  history.commit({ ...history.value, annotations: [mark] });
  mark.end.x = 900;
  assert.equal(history.value.annotations[0].end.x, 400);
  history.undo();
  assert.equal(history.value.annotations.length, 0);
  history.redo();
  assert.equal(history.value.annotations.length, 1);
  const moved = moveAnnotation(history.value.annotations[0], 10, -4);
  assert.deepEqual(moved.start, { x: 210, y: 96 });
  assert.equal(hitAnnotation(moved, { x: 310, y: 196 }), true);
  assert.equal(hitAnnotation(moved, { x: 310, y: 400 }), false);
  history.undo();
  history.commit({
    ...history.value,
    selection: shiftSelection(selection, -1000, 4000, 1920, 1080),
  });
  assert.equal(history.canRedo, false);
  assert.equal(initial.selection, null);
  assert.throws(() => history.commit({ ...history.value, width: 3000 }));
});
test('capture geometry handles reverse drags, locked ratio, eight resize anchors and screen edges', () => {
  const r = { x: 50, y: 50, width: 100, height: 80 };
  assert.deepEqual(resizeSelection(r, 'nw', { x: 300, y: 300 }, 200, 200), {
    x: 148,
    y: 128,
    width: 2,
    height: 2,
  });
  assert.deepEqual(resizeSelection(r, 'se', { x: 500, y: 500 }, 200, 200), {
    x: 50,
    y: 50,
    width: 150,
    height: 150,
  });
  assert.deepEqual(shiftSelection(r, 999, -999, 200, 200), {
    x: 100,
    y: 0,
    width: 100,
    height: 80,
  });
  const square = selectionFrom({ x: 180, y: 180 }, { x: 20, y: 70 }, 200, 200, 1);
  assert.equal(square.width, square.height);
  const wide = selectionFrom({ x: 180, y: 180 }, { x: 300, y: 400 }, 200, 200, 16 / 9);
  assert.ok(wide.x + wide.width <= 200 && wide.y + wide.height <= 200);
});
test('locked selection resizing keeps opposite anchors, edge centers and screen bounds', () => {
  const r = { x: 50, y: 50, width: 100, height: 80 };
  assert.deepEqual(resizeSelection(r, 'n', { x: 100, y: 20 }, 200, 200, 1), {
    x: 45,
    y: 20,
    width: 110,
    height: 110,
  });
  assert.deepEqual(resizeSelection(r, 'w', { x: -900, y: 90 }, 200, 200, 1), {
    x: 0,
    y: 15,
    width: 150,
    height: 150,
  });
  const square = { x: 50, y: 50, width: 100, height: 100 };
  assert.deepEqual(resizeSelection(square, 'se', { x: 149, y: 150 }, 200, 200, 1), {
    x: 50,
    y: 50,
    width: 99,
    height: 99,
  });
  assert.deepEqual(resizeSelection(square, 'se', { x: 150, y: 149 }, 200, 200, 1), {
    x: 50,
    y: 50,
    width: 99,
    height: 99,
  });
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    const locked = resizeSelection(r, handle, { x: 195, y: 185 }, 200, 200, 16 / 9);
    assert.ok(
      locked.x >= 0 &&
        locked.y >= 0 &&
        locked.x + locked.width <= 200 &&
        locked.y + locked.height <= 200,
    );
    assert.ok(Math.abs(locked.width - (locked.height * 16) / 9) < 1);
  }
});
test('capture requests reject stale tokens, duplicate actions, unbounded pixels and image data in recording selections', () => {
  const request = {
    token: 'current',
    selection: { x: 1, y: 2, width: 100, height: 80 },
    actions: ['copy'],
    png: 'abc',
    effects: defaultEffects(),
  };
  assert.deepEqual(captureRequest(request, 'current', 200, 200, false), request);
  assert.throws(() => captureRequest(request, 'old', 200, 200, false));
  assert.throws(() =>
    captureRequest({ ...request, actions: ['copy', 'copy'] }, 'current', 200, 200, false),
  );
  assert.throws(() =>
    captureRequest(
      { ...request, selection: { ...request.selection, x: NaN } },
      'current',
      200,
      200,
      false,
    ),
  );
  assert.throws(() =>
    captureRequest(
      { ...request, selection: { ...request.selection, width: 500 } },
      'current',
      200,
      200,
      false,
    ),
  );
  assert.throws(() => captureRequest(request, 'current', 200, 200, true));
  assert.equal(
    captureRequest(
      { ...request, actions: [], png: undefined, effects: undefined },
      'current',
      200,
      200,
      true,
    ).actions.length,
    0,
  );
});
test('output geometry counts transparent shadow padding before allocating pixels and leaves border inside the selection', () => {
  const effects = defaultEffects();
  effects.radius = 40;
  effects.border.width = 64;
  assert.deepEqual(outputLayout(20, 10, effects), {
    width: 20,
    height: 10,
    x: 0,
    y: 0,
    radius: 5,
    borderWidth: 5,
  });
  effects.shadow = { enabled: true, blur: 10, x: -8, y: 12, opacity: 0.5, color: '#000000' };
  assert.deepEqual(outputLayout(100, 80, effects), {
    width: 160,
    height: 140,
    x: 38,
    y: 18,
    radius: 40,
    borderWidth: 40,
  });
  assert.throws(() => outputLayout(8000, 5000, effects));
  assert.throws(() => outputEffects({ ...effects, radius: NaN }));
  assert.throws(() => outputEffects({ ...effects, border: { width: -1, color: '#000000' } }));
  assert.throws(() => outputEffects({ ...effects, shadow: { ...effects.shadow, opacity: 2 } }));
  effects.shadow.opacity = 0;
  assert.equal(outputLayout(100, 80, effects).width, 100);
});
test('workflow settings preserve order, independent effects and default identity while rejecting duplicate actions or invalid presets', () => {
  const original = defaultCapturePreferences(),
    input = structuredClone(original);
  input.workflows[0].actions = ['library', 'copy', 'save', 'pin'];
  input.workflows[0].effects.radius = 20;
  const stored = validateCapturePreferences(input);
  assert.deepEqual(stored.workflows[0].actions, ['library', 'copy', 'save', 'pin']);
  input.workflows[0].effects.radius = 2;
  assert.equal(stored.workflows[0].effects.radius, 20);
  assert.equal(original.workflows[0].effects.radius, 0);
  assert.throws(() => workflowsFrom([{ ...defaultWorkflows()[0], actions: ['copy', 'copy'] }]));
  assert.throws(() => workflowsFrom([{ ...defaultWorkflows()[0], name: '' }]));
  assert.throws(() => workflowsFrom([defaultWorkflows()[0], defaultWorkflows()[0]]));
  assert.throws(() => validateCapturePreferences({ ...stored, workflowId: 'missing' }));
});
test('ordered capture output resumes after cancellation and failure without repeating acknowledged side effects', async () => {
  const delivery = new CaptureDelivery(),
    events: string[] = [],
    png = Buffer.from('snapshot-one');
  let cancelSave = true,
    failLibrary = true;
  const run = async (action: string) => {
    events.push(action);
    if (action === 'save' && cancelSave) return false;
    if (action === 'library' && failLibrary) throw Error('disk full');
    return true;
  };
  const first = await delivery.execute(png, ['copy', 'save', 'library'], run);
  assert.deepEqual(events, ['copy', 'save']);
  assert.deepEqual(
    first.receipts.map((r) => r.status),
    ['completed', 'canceled', 'pending'],
  );
  cancelSave = false;
  const second = await delivery.execute(png, ['copy', 'save', 'library'], run);
  assert.deepEqual(events, ['copy', 'save', 'save', 'library']);
  assert.equal(second.error, 'disk full');
  assert.deepEqual(
    second.receipts.map((r) => r.status),
    ['completed', 'completed', 'failed'],
  );
  failLibrary = false;
  assert.equal((await delivery.execute(png, ['copy', 'save', 'library'], run)).completed, true);
  assert.deepEqual(events, ['copy', 'save', 'save', 'library', 'library']);
  await delivery.execute(png, ['copy', 'save', 'library'], run);
  assert.equal(events.length, 5);
  await delivery.execute(Buffer.from('changed snapshot'), ['copy'], run);
  assert.equal(events.length, 6);
  await delivery.execute(png, ['save', 'copy'], run);
  assert.deepEqual(events.slice(-2), ['save', 'copy']);
});
test('capture delivery rejects overlapping execution and releases ownership after a rejected step', async () => {
  const delivery = new CaptureDelivery();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const first = delivery.execute(Buffer.from('png'), ['copy'], async () => {
    await held;
    throw Error('clipboard busy');
  });
  await assert.rejects(
    delivery.execute(Buffer.from('png'), ['copy'], async () => true),
    /正在输出/,
  );
  release();
  assert.equal((await first).error, 'clipboard busy');
  assert.equal(
    (await delivery.execute(Buffer.from('png'), ['copy'], async () => true)).completed,
    true,
  );
});
