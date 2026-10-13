const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { createInterface } = require('node:readline');
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const move = user32.func('bool __stdcall SetWindowPos(intptr_t, intptr_t, int, int, int, int, uint32_t)');
const show = user32.func('bool __stdcall ShowWindow(intptr_t, int)');

(async () => {
  const root = path.resolve('work/current/capture-reconstruction');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'snapshot-'));
  const children = [], errors = [];
  let app;
  try {
    for (let index = 0; index < 2; index++) {
      const child = spawn(path.resolve('dist/native/One.CaptureProbe.exe'), ['--fixture'], { windowsHide: true, stdio: 'pipe' });
      children.push({ child });
      const lines = createInterface({ input: child.stdout });
      const [line] = await once(lines, 'line');
      children[index].info = JSON.parse(line);
      lines.close();
      move(children[index].info.hwnd, 0, 80 + index * 400, 80, 500, 350, 0x14);
    }
    const env = { ...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: path.join(directory, 'profile') };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [path.resolve('.')], env });
    app.on('window', page => page.on('pageerror', error => errors.push(String(error))));
    const main = await app.firstWindow();
    await main.waitForFunction(() => !!window.one?.captureWindows);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path.join(directory, 'snapshot.png'));
    await main.evaluate(async () => {
      const settings = await window.one.settings();
      const preset = { ...settings.capture.workflows[0], id: 'snapshot', name: '保存快照', actions: ['save'] };
      await window.one.patchSettings({ capture: { workflows: [preset], workflowId: preset.id } });
    });
    const choices = (await main.evaluate(() => window.one.captureWindows()))
      .filter(choice => choice.name === 'One capture native verification');
    assert.equal(choices.length, 2);
    await main.evaluate(tokens => {
      window.snapshotFinished = false;
      window.snapshotFailure = '';
      void window.one.captureWindowSet(tokens, { hideMainWindow: true },
        tokens.map((token, index) => ({ token, x: index * 520, y: 0 })))
        .then(() => { window.snapshotFinished = true; }, error => { window.snapshotFailure = String(error); });
    }, choices.map(choice => choice.token));
    await expect.poll(() => app.windows().some(page => page.url().endsWith('?view=capture')), { timeout: 15000 }).toBe(true);
    const capture = app.windows().find(page => page.url().endsWith('?view=capture'));
    await capture.waitForFunction(() => document.body.dataset.captureReady === 'true');
    const initial = await capture.evaluate(() => window.one.capture.data());
    assert.equal(initial.layers.length, 2);
    assert.equal(initial.composition, 'windows');
    async function hash() {
      return capture.evaluate(async () => {
        const state = await window.one.capture.data();
        return { revision: state.revision, image: state.image, hashes: await Promise.all(state.layers.map(async layer =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch(layer.image)).arrayBuffer()))).join(','))) };
      });
    }
    const original = await hash();
    // Reject a decoded candidate: old resource URLs and current version must stay valid.
    const candidate = await capture.evaluate(async () => {
      const api = window.one.capture, state = await api.data();
      const next = await api.refresh(state.token);
      await api.refreshReady(state.token, next.revision, false);
      return next;
    });
    assert.deepEqual(await hash(), original);
    await assert.rejects(capture.evaluate(value => window.one.capture.refreshReady(value.token, value.revision, true), candidate), /失效/);
    await capture.locator('#refresh').click();
    await expect.poll(() => capture.evaluate(async () => (await window.one.capture.data()).revision)).toBeGreaterThan(candidate.revision);
    const stable = await hash();
    // Size changes and even same-canvas-size layer changes cannot silently move annotations.
    move(children[0].info.hwnd, 0, 180, 100, 600, 400, 0x14);
    await capture.locator('#refresh').click();
    await expect(capture.locator('#capture-message')).toContainText('已保留原快照');
    assert.deepEqual(await hash(), stable);
    show(children[0].info.hwnd, 6);
    await capture.locator('#refresh').click();
    await expect(capture.locator('#capture-message')).toContainText('关闭或最小化');
    assert.deepEqual(await hash(), stable);
    for (const { child } of children) {
      const done = once(child, 'close');
      child.stdin.write('quit\n');
      await done;
    }
    await capture.locator('#refresh').click();
    await expect(capture.locator('#capture-message')).toContainText('关闭或最小化');
    assert.deepEqual(await hash(), stable);
    // Simulate display reconfiguration without changing the user's display settings.
    await app.evaluate(({ screen }) => {
      const displays = screen.getAllDisplays.bind(screen);
      screen.getAllDisplays = () => displays().map(display => ({ ...display, rotation: (display.rotation + 90) % 360 }));
    });
    await capture.locator('#capture-more').click();
    await capture.locator('#run-workflow').click();
    await expect.poll(() => main.evaluate(() => window.snapshotFinished), { timeout: 10000 }).toBe(true)
      .catch(async error => { console.error('Snapshot output:', await capture.locator('#capture-message').textContent(), await main.evaluate(() => window.snapshotFailure)); throw error; });
    assert.equal(await main.evaluate(() => window.snapshotFailure), '');
    const saved = await require('sharp')(path.join(directory, 'snapshot.png')).metadata();
    assert.deepEqual([saved.width, saved.height], [initial.width, initial.height]);
    assert.deepEqual(errors, []);
    console.log('Snapshot window: multi-window capture, candidate rejection/commit, stale revision, resize/minimize/closure recovery and offline export after display changes passed.');
  } finally {
    if (app) await app.close();
    for (const { child } of children) if (child.exitCode === null) {
      const done = once(child, 'close'); child.stdin.write('quit\n'); await done;
    }
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), await fs.realpath(root));
    assert.ok(path.basename(actual).startsWith('snapshot-'));
    await fs.rm(actual, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
