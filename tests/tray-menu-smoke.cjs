const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
async function run(){
 const out=path.resolve('work/current/sidebar-tray');await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'tray-profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_TRAY_MENU:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=search]');
  const open=()=>app.evaluate(()=>globalThis.oneTestTrayMenu.open({x:150,y:150,width:24,height:24}));await open();
  await expect.poll(()=>app.windows().some(p=>p.url().includes('view=tray-menu'))).toBe(true);
  const menu=app.windows().find(p=>p.url().includes('view=tray-menu'));await expect(menu.locator('.tray-menu-card')).toBeVisible();
  assert.deepEqual(await menu.locator('#tray-menu-items [data-action]').evaluateAll(es=>es.map(e=>e.dataset.action)),['open','search','capture-region','capture-recording','pins-clipboard','more','settings','startup','restart','quit']);
  await expect(menu.locator('[data-action=capture-region] .tray-menu-shortcut')).toHaveText('Ctrl+Shift+F8');
  await expect(menu.locator('[data-action=open] .tray-menu-shortcut')).toHaveText('Ctrl+Alt+O');
  await menu.locator('[data-action=more]').hover();
  await expect.poll(()=>app.windows().filter(p=>p.url().includes('view=tray-menu')).length).toBe(2);
  const more=app.windows().find(p=>p!==menu&&p.url().includes('view=tray-menu'));await expect(more.locator('.tray-menu-card')).toBeVisible();await expect(more.locator('[data-action]')).toHaveCount(11);await expect(more.locator('.tray-menu-section h2')).toHaveCount(3);
  assert.equal(await app.evaluate(()=>globalThis.oneTestTrayMenu.window.isVisible()),true);assert.equal(await app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible()),true);
  await menu.locator('#tray-menu-pause').click();await expect(menu.locator('#tray-menu-pause')).toHaveAttribute('aria-label','恢复操作增强');await expect(menu.locator('#tray-menu-status')).toHaveText('操作增强已暂停');await menu.locator('#tray-menu-pause').click();await expect(menu.locator('#tray-menu-status')).toHaveText('随时可用');
  await menu.locator('[data-action=startup]').click();await expect(menu.locator('[data-action=startup]')).toHaveAttribute('aria-checked','true');await menu.locator('[data-action=startup]').click();await expect(menu.locator('[data-action=startup]')).toHaveAttribute('aria-checked','false');
  await expect(menu.locator('[data-action=restart]')).toHaveText('重启 One');
  await menu.locator('[data-action=more]').focus();await menu.keyboard.press('ArrowRight');await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible())).toBe(true);await more.keyboard.press('ArrowLeft');await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible())).toBe(false);await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.window.isFocused())).toBe(true);
  await menu.keyboard.press('Escape');await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.window.isVisible())).toBe(false);
  await main.evaluate(()=>window.one.patchSettings({capture:{shortcuts:{region:'Ctrl+Shift+F7'}}}));await open();await expect(menu.locator('[data-action=capture-region] .tray-menu-shortcut')).toHaveText('Ctrl+Shift+F7');
  await menu.locator('[data-action=more]').click();await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible())).toBe(true);
  await menu.locator('[data-action=search]').hover();await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible())).toBe(false);await menu.locator('[data-action=more]').hover();await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible())).toBe(true);
  await main.evaluate(()=>window.one.patchSettings({appearance:{mode:'dark'}}));await expect(more.locator('[data-action=preview]')).toBeVisible();
  await more.keyboard.press('Escape');await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow.isVisible())).toBe(false);
  await menu.locator('[data-action=open]').click();await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.window.isVisible())).toBe(false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',rootRows:10,headerPause:true,moreRows:11,groups:3,hover:true,shortcutRefresh:true,pauseResume:true,startup:true,restart:true,submenuFocus:true,keyboard:true,reopen:true}));
 }finally{await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
