import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalInferenceScheduler } from '../src/main/local-inference-scheduler';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const client = () => ({ owner: Symbol() });
const signal = () => new AbortController().signal;

test('FIFO admission retains a warm client and unloads it before a different engine starts', async () => {
  const scheduler = new LocalInferenceScheduler(), events: string[] = [], held = gate();
  const a = { owner: Symbol(), unload: async () => { events.push('unload-a'); } }, b = client();
  const first = scheduler.run(a, signal(), async () => { events.push('a1'); await held.promise; });
  const second = scheduler.run(a, signal(), async () => { events.push('a2'); });
  const third = scheduler.run(b, signal(), async () => { events.push('b'); });
  assert.deepEqual(events, ['a1']); assert.equal(scheduler.pending, 2); held.resolve();
  await Promise.all([first, second, third]); assert.deepEqual(events, ['a1', 'a2', 'unload-a', 'b']);
  assert.equal(scheduler.running, false); assert.equal(scheduler.pending, 0);
});
test('queued cancellation is immediate and never invokes native work', async () => {
  const scheduler = new LocalInferenceScheduler(), held = gate(), abort = new AbortController(); let invoked = false;
  const first = scheduler.run(client(), signal(), () => held.promise);
  const queued = scheduler.run(client(), abort.signal, async () => { invoked = true; });
  abort.abort(); await assert.rejects(queued, /取消/); assert.equal(scheduler.pending, 0); assert.equal(invoked, false);
  held.resolve(); await first;
});
test('an active cancellation cannot admit the next job before native cleanup finishes', async () => {
  const scheduler = new LocalInferenceScheduler(), abort = new AbortController(), cleanup = gate(), cancelling = gate(); let next = false;
  const first = scheduler.run(client(), abort.signal, async () => {
    await new Promise<void>(resolve => abort.signal.addEventListener('abort', () => { cancelling.resolve(); resolve(); }, { once: true }));
    await cleanup.promise; throw Error('取消');
  });
  const rejected = assert.rejects(first, /取消/);
  const second = scheduler.run(client(), signal(), async () => { next = true; });
  abort.abort(); await cancelling.promise; assert.equal(next, false); assert.equal(scheduler.pending, 1);
  cleanup.resolve(); await rejected; await second; assert.equal(next, true);
});
test('cancellation during cache handoff releases the old model without loading the cancelled one', async () => {
  const scheduler = new LocalInferenceScheduler(), unloading = gate(), unloaded = gate(); let loads = 0, releases = 0;
  await scheduler.run({ owner: Symbol(), unload: async () => { releases++; unloading.resolve(); await unloaded.promise; } }, signal(), async () => {});
  const abort = new AbortController(), queued = scheduler.run(client(), abort.signal, async () => { loads++; });
  const rejected = assert.rejects(queued, /取消/); await unloading.promise; abort.abort(); unloaded.resolve(); await rejected;
  await scheduler.run(client(), signal(), async () => { loads++; }); assert.equal(releases, 1); assert.equal(loads, 1);
});
test('cache release failures block admission, while task failure and queue overflow remain recoverable', async () => {
  const scheduler = new LocalInferenceScheduler(1), held = gate(); let failed = true, loaded = false;
  await scheduler.run({ owner: Symbol(), unload: async () => { if (failed) throw Error('release failure'); } }, signal(), async () => {});
  await assert.rejects(scheduler.run(client(), signal(), async () => { loaded = true; }), /release failure/); assert.equal(loaded, false);
  failed = false; await assert.rejects(scheduler.run(client(), signal(), async () => { throw Error('native failure'); }), /native failure/);
  const first = scheduler.run(client(), signal(), () => held.promise), second = scheduler.run(client(), signal(), async () => {});
  await assert.rejects(scheduler.run(client(), signal(), async () => {}), /队列已满/); held.resolve(); await Promise.all([first, second]);
  const abort = new AbortController(); abort.abort(); await assert.rejects(scheduler.run(client(), abort.signal, async () => {}), /取消/);
});
