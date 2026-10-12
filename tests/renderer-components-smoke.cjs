const { _electron: electron, expect } = require('@playwright/test');
const {build} = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('work/current/capture-migration');
  await fs.mkdir(root, {recursive: true});
  const profile = await fs.mkdtemp(path.join(root, 'components-profile-'));
  const bundle = await build({stdin: {contents: `
    export * from './src/renderer/segments';
    export * from './src/renderer/dialog';
    export * from './src/renderer/anchored-popover';
    export * from './src/renderer/dom-lifecycle';
  `, resolveDir: path.resolve('.')}, bundle: true, platform: 'browser', format: 'iife', globalName: 'components', write: false});
  const env = {...process.env, ONE_COMPONENT_TEST_PROFILE: profile};
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({args: [path.resolve('tests/renderer-components/main.cjs')], env});
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(`<style>
      .tabs {display:flex;position:relative;width:360px} .tabs button {width:120px;height:36px}
      .popup {position:fixed;width:120px;height:80px} [hidden] {display:none!important}
      dialog {width:300px} dialog.closing {opacity:.5}
    </style><button id="opener">open</button><main id="app"><section id="page" hidden>
      <div class="tabs"><button class="selected">screen</button><button disabled>disabled</button><button>camera</button></div>
    </section></main><button id="anchor">anchor</button><div id="popup" class="popup"></div>`);
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    const same = await page.evaluate(() => {
      window.segmentController = components.setupSegments();
      return window.segmentController === components.setupSegments();
    });
    assert.equal(same, true, 'Repeated setup reuses the existing root controller');
    await page.evaluate(() => document.querySelector('#page').hidden = false);
    const tabs = page.locator('.tabs');
    await expect(tabs).toHaveClass(/segment-ready/);
    await expect.poll(() => tabs.evaluate(el => el.style.getPropertyValue('--segment-width'))).toBe('120px');
    await page.evaluate(() => {
      window.segmentClicks = 0;
      document.querySelector('.tabs').addEventListener('click', event => {
        if (!(event.target instanceof HTMLButtonElement)) return;
        window.segmentClicks++;
        for (const button of event.currentTarget.children) button.classList.toggle('selected', button === event.target);
      });
    });
    await tabs.locator('button').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.locator('button').last()).toBeFocused();
    assert.equal(await page.evaluate(() => window.segmentClicks), 1);
    await expect.poll(() => tabs.evaluate(el => el.style.getPropertyValue('--segment-x'))).toBe('240px');
    await page.evaluate(() => document.querySelector('#page').hidden = true);
    await expect(tabs).not.toHaveClass(/segment-ready/);
    await page.evaluate(() => document.querySelector('#page').hidden = false);
    await expect(tabs).toHaveClass(/segment-ready/);
    await page.evaluate(() => {
      const group = document.querySelector('.tabs');
      const button = document.createElement('button');button.textContent = 'audio';group.append(button);
      window.segmentController.refresh();
    });
    await tabs.locator('button').first().focus();
    await page.keyboard.press('End');
    await expect(tabs.locator('button').last()).toBeFocused();
    await page.evaluate(() => window.segmentController.dispose());
    await page.keyboard.press('Home');
    await expect(tabs.locator('button').last()).toBeFocused();
    assert.equal(await page.evaluate(() => window.segmentClicks), 2, 'Disposed segments have no active keyboard handlers');
    await page.evaluate(() => {
      window.oldRoot = document.querySelector('#app');
      window.oldController = components.setupSegments(window.oldRoot);
      window.oldRoot.remove();
    });
    await page.evaluate(() => document.body.append(window.oldRoot));
    await tabs.locator('button').first().focus();
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => window.segmentClicks), 2, 'Removing a mounted root disposes its handlers');
    assert.equal(await page.evaluate(() => components.setupSegments(window.oldRoot) === window.oldController), false);
    await page.keyboard.press('End');
    await expect(tabs.locator('button').last()).toBeFocused();
    assert.equal(await page.evaluate(() => window.segmentClicks), 3, 'Remounting installs exactly one controller');

    await page.evaluate(() => {
      window.detachCount = 0;
      const anchor = document.querySelector('#anchor'), popup = document.querySelector('#popup');
      window.stopTracking = components.trackAnchoredPopover(anchor, popup, {preferred:'below', gap:5}, () => window.detachCount++);
      anchor.remove();
    });
    await expect.poll(() => page.evaluate(() => window.detachCount)).toBe(1);
    await page.evaluate(() => {window.dispatchEvent(new Event('resize'));window.stopTracking();});
    assert.equal(await page.evaluate(() => window.detachCount), 1, 'Detachment is reported exactly once');
    await page.evaluate(() => {
      window.removals = 0;
      const element = document.createElement('span');document.body.append(element);
      components.onRemoval(element, () => window.removals++);
      components.onRemoval(element, () => window.removals++);
      document.querySelector('#app').append(element);
      window.removalElement = element;
    });
    assert.equal(await page.evaluate(() => window.removals), 0, 'Reparenting does not dispose a connected control');
    await page.evaluate(() => window.removalElement.remove());
    await expect.poll(() => page.evaluate(() => window.removals)).toBe(2);
    await page.evaluate(() => {
      const transient = document.createElement('span');
      components.onRemoval(transient, () => window.removals++);
      document.body.append(transient);transient.remove();
    });
    await expect.poll(() => page.evaluate(() => window.removals)).toBe(3);

    await page.locator('#opener').focus();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', components.dialogMarkup({id:'form', title:'Running form',
        body:'<form method="dialog"><input aria-label="name"><button id="submit" type="submit">submit</button></form>'}));
      window.dialog = document.querySelector('#form');
      components.openDialog(window.dialog);
      window.unlockA = components.lockDialogDismiss(window.dialog);
      window.unlockB = components.lockDialogDismiss(window.dialog);
    });
    const dialog = page.locator('#form');
    await expect(dialog.locator('input')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('#form-close').click();
    await page.locator('#submit').click();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    assert.equal(await page.evaluate(() => components.closeDialog(window.dialog)), false);
    await page.evaluate(() => {window.unlockA();window.unlockA();});
    assert.equal(await page.evaluate(() => components.closeDialog(window.dialog)), false, 'A repeated unlock cannot release another operation');
    await page.evaluate(() => window.unlockB());
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#opener')).toBeFocused();
    const closeResult = await page.evaluate(async () => {
      components.openDialog(window.dialog);
      const closing = components.closeDialog(window.dialog);
      const unlock = components.lockDialogDismiss(window.dialog);
      const result = await closing;
      await components.closeDialog(window.dialog, {force:true});
      unlock();
      return result;
    });
    assert.equal(closeResult, false, 'Lock acquisition cancels an already pending dismissal');
    await expect(dialog).not.toBeVisible();
    assert.deepEqual(errors, []);
    console.log('Renderer component checks passed: dynamic segments, disposal, popup detachment and nested dialog locks.');
  } finally {
    await app?.close();
    const actual = await fs.realpath(profile);
    assert.ok(actual.startsWith(root + path.sep) && actual === profile);
    await fs.rm(actual, {recursive:true, force:true});
  }
})().catch(error => {console.error(error);process.exitCode=1;});
