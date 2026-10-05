const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

async function run(){
 const out=path.resolve('work/current/tray-menu-smoke');await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_TRAY_MENU:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});const errors=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=search]');
  await app.evaluate(()=>globalThis.oneTestTrayMenu.open({x:150,y:150,width:24,height:24}));
  await expect.poll(()=>app.windows().some(page=>page.url().includes('view=tray-menu'))).toBe(true);
  const menu=app.windows().find(page=>page.url().includes('view=tray-menu'));
  await expect(menu.locator('.tray-menu-card')).toBeVisible();
  await expect(menu.locator('[data-action=open]')).toHaveText('打开 One');
  await expect(menu.locator('[data-action=startup]')).toBeVisible();
  await menu.screenshot({path:path.join(out,'light.png')});
  await menu.locator('#tray-menu-pause').click();
  await expect(menu.locator('#tray-menu-status')).toHaveText('操作增强已暂停');
  await menu.locator('#tray-menu-pause').click();
  await expect(menu.locator('#tray-menu-status')).toHaveText('随时可用');
  await menu.locator('[data-action=startup]').click();
  await expect(menu.locator('[data-action=startup]')).toHaveAttribute('data-active','true');
  await menu.locator('[data-action=startup]').click();
  await expect(menu.locator('[data-action=startup]')).not.toHaveAttribute('data-active','true');
  await menu.keyboard.press('Escape');
  await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.window?.isVisible()??false)).toBe(false);
  await app.evaluate(()=>globalThis.oneTestTrayMenu.open({x:150,y:150,width:24,height:24}));
  await expect.poll(()=>app.windows().some(page=>page.url().includes('view=tray-menu')&&!page.isClosed())).toBe(true);
  const reopened=app.windows().find(page=>page.url().includes('view=tray-menu')&&!page.isClosed());
  await expect(reopened.locator('.tray-menu-card')).toBeVisible();
  await reopened.locator('[data-action=open]').click();
  await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.window?.isVisible()??false)).toBe(false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',menuActions:true,pauseResume:true,startupToggle:true,escapeDismiss:true,reopen:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
