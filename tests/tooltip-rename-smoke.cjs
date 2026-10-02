const {_electron: electron, expect} = require('@playwright/test');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');

async function run() {
 const out = path.resolve(process.env.ONE_TEST_OUTPUT_DIR || 'work/current/tooltip-rename-smoke');
 await fs.mkdir(out, {recursive: true});
 const profile = await fs.mkdtemp(path.join(out, 'profile-')), files = await fs.mkdtemp(path.join(out, 'files-'));
 await fs.writeFile(path.join(files, 'old-a.txt'), 'First fixture'); await fs.writeFile(path.join(files, 'old-b.md'), 'Second fixture');
 const env = {...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile}; delete env.ELECTRON_RUN_AS_NODE;
 const app = await electron.launch({args: [path.resolve('.')], env}), errors = [], tooltips = [], layouts = [], overviewHovers = [];
 app.on('window', page => page.on('pageerror', error => errors.push(String(error))));
 try {
  const page = await app.firstWindow(); await page.waitForSelector('#overview-index'); const win = await app.browserWindow(page);
  await win.evaluate(w => {w.setSize(1250, 900); w.show(); w.focus();});
  await page.evaluate(() => {window.tooltipEvents = []; for (const name of ['pointerover','pointerout','focusin','focusout','pointerdown','keydown','scroll','blur','resize']) window.addEventListener(name, e => {window.tooltipEvents.push({name, time: performance.now(), target: e.target?.id || e.target?.className, related: e.relatedTarget?.id || e.relatedTarget?.className}); if (window.tooltipEvents.length > 60) window.tooltipEvents.shift();}, true);});
  const showTip = async (button, label, side) => {
   await button.hover(); const tip = page.locator('#one-tooltip.visible');
   await expect(tip).toHaveText(label); await expect(tip).toHaveAttribute('data-side', side);
   await expect(tip).toHaveCSS('opacity', '1');
   const geometry = await button.evaluate(el => {
    const tip = document.querySelector('#one-tooltip'), r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const arrow = getComputedStyle(tip, '::before');
    return {label: tip.textContent, side: tip.dataset.side, button: r.toJSON(), tip: t.toJSON(), viewport: [innerWidth, innerHeight],
     arrow: {width: arrow.width, height: arrow.height, left: arrow.left, right: arrow.right, top: arrow.top, bottom: arrow.bottom, transform: arrow.transform},
     described: el.getAttribute('aria-describedby'), title: el.getAttribute('title'), arrowOffset: parseFloat(tip.style.getPropertyValue('--tooltip-arrow'))};
   });
   assert.equal(geometry.title, null); assert.ok(geometry.described.split(' ').includes('one-tooltip'));
   assert.equal(geometry.arrow.width, '8px'); assert.equal(geometry.arrow.height, '8px'); assert.notEqual(geometry.arrow.transform, 'none');
   assert.ok(geometry.tip.left >= 7 && geometry.tip.top >= 7 && geometry.tip.right <= geometry.viewport[0] - 7 && geometry.tip.bottom <= geometry.viewport[1] - 7, JSON.stringify(geometry));
   if (side === 'right') {assert.ok(geometry.tip.left >= geometry.button.right + 10); assert.equal(geometry.arrow.left, '-5px'); assert.ok(Math.abs(geometry.tip.top + geometry.arrowOffset - geometry.button.top - geometry.button.height / 2) < 1.1);}
   else if (side === 'left') assert.ok(geometry.tip.right <= geometry.button.left - 10);
   else if (side === 'top') assert.ok(geometry.tip.bottom <= geometry.button.top - 10);
   else assert.ok(geometry.tip.top >= geometry.button.bottom + 10);
   tooltips.push(geometry); return geometry;
  };
  for (const theme of ['light', 'dark']) {
   await page.locator('[data-page=settings]').click(); await page.locator('[data-settings-tab=appearance]').click(); await page.locator(`[data-mode=${theme}]`).click();
   for (const collapsed of [false, true]) {
    const expanded = await page.locator('#sidebar-toggle').getAttribute('aria-expanded') === 'true';
    if (expanded === collapsed) await page.locator('#sidebar-toggle').click();
    await expect.poll(() => page.locator('.sidebar').evaluate(e => Math.round(e.getBoundingClientRect().width))).toBe(collapsed ? 56 : 208);
    for (const button of await page.locator('.sidebar .nav').all()) await showTip(button, await button.getAttribute('aria-label'), 'right');
    await showTip(page.locator('[data-page=tools]'), '文件工具', 'right');
    await page.screenshot({path: path.join(out, `sidebar-${theme}-${collapsed ? 'collapsed' : 'expanded'}.png`)});
   }
   await page.locator('[data-page=home]').click();
   const capacity = page.locator('.overview-columns .section-heading>[data-overview-tool=system]'), before = await capacity.boundingBox();
   await capacity.hover(); await page.waitForTimeout(180);
   const hover = await capacity.evaluate(e => {const s = getComputedStyle(e), heading = e.parentElement.querySelector('h2').getBoundingClientRect(), b = e.getBoundingClientRect(); return {box: b.toJSON(), padding: [s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft], radius:s.borderRadius, background:s.backgroundColor, heading:heading.toJSON(), icon:getComputedStyle(e.querySelector('.icon')).width};});
   assert.deepEqual(hover.padding, ['4px','8px','4px','8px']); assert.equal(hover.radius,'7px'); assert.equal(hover.icon,'13px');
   assert.ok(Math.abs(hover.box.y+hover.box.height/2-hover.heading.y-hover.heading.height/2)<1);
   assert.ok(Math.abs(hover.box.width-before.width)<.1 && Math.abs(hover.box.height-before.height)<.1);
   assert.notEqual(hover.background,'rgba(0, 0, 0, 0)'); overviewHovers.push({theme,...hover});
   await page.screenshot({path:path.join(out,`overview-hover-${theme}.png`)});
   await capacity.click(); await expect(page.locator('#alerts-tab')).toHaveAttribute('aria-selected','true');
  }
  await page.mouse.move(500, 50); await page.locator('[data-page=home]').focus(); await page.keyboard.press('Tab');
  await expect(page.locator('[data-page=tools]')).toBeFocused(); await expect(page.locator('#one-tooltip.visible')).toHaveText('文件工具');
  await expect(page.locator('#one-tooltip')).toHaveAttribute('data-side', 'right');
  await page.keyboard.press('Escape'); await expect(page.locator('#one-tooltip')).not.toHaveClass(/visible/);
  await page.locator('[data-page=tools]').evaluate(e => e.setAttribute('aria-describedby', 'existing-help'));
  await showTip(page.locator('[data-page=tools]'), '文件工具', 'right'); await page.mouse.move(500, 50);
  await expect(page.locator('[data-page=tools]')).toHaveAttribute('aria-describedby', 'existing-help');
  await page.locator('[data-page=tools]').evaluate(e => e.removeAttribute('aria-describedby'));

  // Dynamic controls at each edge must flip without native duplicate tips or clipped arrows.
  for (const [preferred, side, position] of [['top', 'bottom', {top: '8px', left: '500px'}], ['right', 'left', {right: '8px', top: '300px'}], ['bottom', 'top', {bottom: '8px', left: '500px'}], ['left', 'right', {left: '8px', top: '300px'}]]) {
   await page.evaluate(({preferred, position}) => {const b = document.createElement('button'); b.id = 'tooltip-edge'; b.title = '边界提示'; b.dataset.tooltipSide = preferred; Object.assign(b.style, {position: 'fixed', zIndex: '100', width: '36px', height: '36px', padding: '0'}, position); b.textContent = '?'; document.body.append(b);}, {preferred, position});
   await showTip(page.locator('#tooltip-edge'), '边界提示', side); await page.mouse.move(500, 50); await page.locator('#tooltip-edge').evaluate(e => e.remove());
  }
  await page.evaluate(() => {const d = document.createElement('dialog'); d.id = 'tooltip-modal'; d.className = 'one-dialog'; d.innerHTML = '<header class="one-dialog-heading"><h2>提示验证</h2><button id="tooltip-modal-button" class="icon-button" title="弹窗中的提示" data-tooltip-side="right">?</button></header><div class="one-dialog-body">动态按钮使用同一个提示组件。</div>'; document.body.append(d); d.showModal();});
  await showTip(page.locator('#tooltip-modal-button'), '弹窗中的提示', 'right');
  assert.equal(await page.locator('#one-tooltip').evaluate(e => e.parentElement.id), 'tooltip-modal');
  await page.screenshot({path: path.join(out, 'modal.png')});
  await page.evaluate(() => {const d = document.querySelector('#tooltip-modal'); d.close(); d.remove();});

  await page.locator('[data-page=tools]').click(); await page.locator('#tool-tab-rename').click();
  await expect(page.locator('#tool-run')).toContainText('预览重命名');
  const details = page.locator('#rename-format-options'); await expect(details).not.toHaveAttribute('open');
  await expect(page.locator('#rename-case-mode')).not.toBeVisible();
  await page.locator('#rename-paths').fill(files); await page.locator('#rename-search').fill('old'); await page.locator('#rename-replace').fill('new');
  await page.locator('#tool-run').click(); await expect(page.locator('#rename-apply')).toBeEnabled();
  await expect(page.locator('.rename-result-row')).toContainText(['new-a.txt', 'new-b.md']);
  await details.locator('summary').focus(); await page.keyboard.press('Enter'); await expect(details).toHaveAttribute('open');
  await page.locator('#rename-start').fill('5'); await page.locator('#rename-increment').fill('2'); await page.locator('#rename-padding').fill('2');
  await page.locator('#rename-replace').fill('new_${n}'); await expect(page.locator('.rename-result-row')).toContainText(['new_05-a.txt', 'new_07-b.md']);
  await page.locator('#rename-case-mode').click(); await page.getByRole('option', {name: '全部大写', exact: true}).click();
  await expect(page.locator('.rename-result-row')).toContainText(['NEW_05-A.txt', 'NEW_07-B.md']);
  await details.locator('summary').click(); await expect(details).not.toHaveAttribute('open');
  await expect(page.locator('#rename-apply')).toBeEnabled();
  assert.deepEqual(await fs.readdir(files), ['old-a.txt', 'old-b.md'], 'Preview and disclosure must not rename anything');
  for (const theme of ['light', 'dark']) {
   await page.locator('[data-page=settings]').click(); await page.locator('[data-settings-tab=appearance]').click(); await page.locator(`[data-mode=${theme}]`).click();
   await page.locator('[data-page=tools]').click();
   if (await page.locator('#sidebar-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#sidebar-toggle').click();
   for (const size of [[1250, 900], [950, 650], [840, 600]]) for (const open of [false, true]) {
    await win.evaluate((w, size) => w.setSize(...size), size);
    if (await details.evaluate(e => e.open) !== open) await details.locator('summary').click();
    await page.locator('.content').evaluate(e => e.scrollTop = 0); await page.waitForTimeout(220);
    const layout = await page.evaluate(() => {const root = document.querySelector('.content'), form = document.querySelector('.rename-config');
     return {viewport: [innerWidth, innerHeight], form: form.getBoundingClientRect().toJSON(), overflow: root.scrollWidth > root.clientWidth + 1,
      fields: [...form.querySelectorAll('input,textarea,.custom-select')].filter(e => e.checkVisibility()).map(e => ({id: e.id, type: e.type, box: e.getBoundingClientRect().toJSON()}))};});
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    for (const field of layout.fields) assert.ok(field.box.left >= layout.form.left && field.box.right <= layout.form.right + 1 && field.box.width >= (field.type === 'checkbox' ? 16 : 44), JSON.stringify(field));
    layouts.push({theme, size, open, ...layout});
    await page.screenshot({path: path.join(out, `rename-${theme}-${size.join('x')}-${open ? 'open' : 'closed'}.png`)});
    await page.locator('#rename-apply').scrollIntoViewIfNeeded(); await expect(page.locator('#rename-apply')).toBeInViewport();
   }
  }
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.locator('.content').evaluate(e => e.scrollTop = 0);
  if (!await details.evaluate(e => e.open)) await details.locator('summary').click();
  assert.equal(await page.locator('.rename-format-body').evaluate(e => getComputedStyle(e).animationName), 'none');
  await showTip(page.locator('[data-page=tools]'), '文件工具', 'right');
  assert.equal(await page.locator('#one-tooltip').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
  await page.mouse.down(); await page.mouse.up(); await expect(page.locator('#one-tooltip')).not.toHaveClass(/visible/);
  assert.deepEqual(errors, []);
  const result = {result: 'PASS', tooltips, layouts, overviewHovers, keyboardTip: true, existingDescriptionPreserved: true, dynamicEdges: true, modal: true, numberingPreview: true, advancedRulesPreserved: true, reducedMotion: true, errors};
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({result: 'PASS', tooltipChecks: tooltips.length, layouts: layouts.length, errors}));
 } catch (error) {
  const page = await app.firstWindow().catch(() => null); if (page) {await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {}); await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),events:await page.evaluate(()=>window.tooltipEvents),windows:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),visible:w.isVisible(),focused:w.isFocused()})))},null,2));}
  throw error;
 } finally {await app.close();}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
