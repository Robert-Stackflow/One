const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
async function run(){
 const out=path.resolve('work/current/sidebar-tray');await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'sidebar-profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app;const errors=[];
 const launch=async()=>{app=await electron.launch({args:[path.resolve('.')],env});app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));const page=await app.firstWindow();page.on('pageerror',e=>errors.push(String(e)));await page.waitForSelector('[data-sidebar-group-toggle=files]');return page;};
 const prefs=page=>page.evaluate(async()=> (await window.one.settings()).sidebar);
 const open=async page=>{await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=appearance]').click();await page.locator('#appearance-sidebar-order').click();await expect(page.locator('#sidebar-order-dialog')).toBeVisible();};
 try{
  let page=await launch();const defaults=await prefs(page);assert.equal(defaults.order.tools[0],'ai');assert.equal(defaults.pinned.length,12);assert.ok(defaults.pinned.includes('ports'));
  await expect(page.locator('[data-sidebar-group=tools] .nav').first()).toHaveAttribute('data-page','ai');
  const shape=await page.locator('.sidebar-navigation').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,bar:getComputedStyle(e).scrollbarWidth}));assert.equal(shape.bar,'none');assert.ok(shape.scroll<=shape.width);
  const motion=await page.evaluate(()=>{document.querySelector('[data-sidebar-group-toggle=files]').click();return [...document.querySelectorAll('[data-sidebar-group=files] .nav,.sidebar-group-count')].flatMap(e=>e.getAnimations()).filter(a=>a.effect.getTiming().duration===190||a.effect.getTiming().duration===180).length;});assert.ok(motion>=3);
  await expect(page.locator('[data-page=text]')).toBeHidden();await expect(page.locator('[data-page=archive]')).toBeHidden();await expect(page.locator('[data-page=tools]')).toBeVisible();await expect(page.locator('[data-sidebar-group=files] .sidebar-group-count')).toHaveText('2');
  await expect.poll(async()=> (await prefs(page)).collapsed.files).toBe(true);
  const badgeLayout=await page.locator('[data-sidebar-group=files] .sidebar-group-header').evaluate(e=>{const title=e.querySelector('h2').getBoundingClientRect(),badge=e.querySelector('.sidebar-group-count').getBoundingClientRect();return {gap:badge.x-title.right,height:badge.height};});assert.ok(badgeLayout.gap<=5);assert.equal(badgeLayout.height,16);
  await page.locator('.sidebar').screenshot({path:path.join(out,'sidebar-light.png')});
  await open(page);await expect(page.locator('#sidebar-order-dialog .one-dialog-actions')).toHaveCount(0);await expect(page.locator('.sidebar-fold-option span').first()).toHaveText('固定');
  await page.locator('[data-sidebar-pin=preview]').check();await expect.poll(async()=> (await prefs(page)).pinned.includes('preview')).toBe(true);
  await page.locator('[data-sort-handle=tools]').focus();await page.keyboard.press('ArrowDown');await expect.poll(async()=> (await prefs(page)).order.files[0]).toBe('text');
  const source=page.locator('[data-sort-handle=archive]'),target=page.locator('[data-sort-page=search]');await source.dragTo(target,{targetPosition:{x:50,y:8}});await expect.poll(async()=> (await prefs(page)).order.files.indexOf('archive')<(await prefs(page)).order.files.indexOf('search')).toBe(true);
  const beforeCross=(await prefs(page)).order;await page.locator('[data-sort-handle=archive]').dragTo(page.locator('[data-sort-page=ai]'));assert.deepEqual((await prefs(page)).order,beforeCross);
  await page.locator('#sidebar-order-dialog-close').click();await expect(page.locator('#sidebar-order-dialog')).toHaveCount(0);
  await page.locator('[data-sidebar-group-toggle=tools]').click();await expect(page.locator('[data-page=preview]')).toBeVisible();await expect.poll(async()=> (await prefs(page)).collapsed.tools).toBe(true);
  const saved=await prefs(page);await app.close();app=undefined;page=await launch();assert.deepEqual(await prefs(page),saved);await expect(page.locator('[data-page=text]')).toBeHidden();await expect(page.locator('[data-page=preview]')).toBeVisible();
  await open(page);await page.locator('#sidebar-order-reset').click();await expect.poll(()=>prefs(page)).toEqual(defaults);await page.locator('#sidebar-order-dialog-close').click();await expect(page.locator('[data-page=text]')).toBeVisible();await expect(page.locator('[data-sidebar-group=tools] .nav').first()).toHaveAttribute('data-page','ai');
  await page.locator('#sidebar-toggle').click();await expect.poll(()=>page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width))).toBe(56);
  const narrow=await page.locator('.sidebar-navigation').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,buttons:[...e.querySelectorAll('.nav:not([hidden])')].map(b=>Math.round(b.getBoundingClientRect().width)),lines:[...e.querySelectorAll('.sidebar-group')].map(g=>getComputedStyle(g,'::before').display)}));assert.ok(narrow.scroll<=narrow.width);assert.ok(narrow.buttons.every(w=>w===40));assert.ok(narrow.lines.every(v=>v!=='none'));
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-sidebar-group-toggle=files]').click();assert.equal(await page.locator('[data-sidebar-group=files]').evaluate(e=>e.getAnimations({subtree:true}).length),0);await expect(page.locator('[data-page=text]')).toBeHidden();
  await page.locator('#sidebar-toggle').click();await open(page);await page.evaluate(()=>window.one.patchSettings({appearance:{mode:'dark'}}));await page.locator('#sidebar-order-dialog').screenshot({path:path.join(out,'sidebar-dialog-dark.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',immediatePin:true,keyboardSort:true,dragSort:true,crossGroupBlocked:true,restartPersistence:true,reset:true,animations:true,countTag:true,hiddenScrollbar:true,narrowWidth:true,reducedMotion:true}));
 }finally{if(app)await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
