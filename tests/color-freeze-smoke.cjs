const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');

async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-color-freeze-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.locator('[data-page="color"]').click();
  await page.locator('#color-pick-options').click();
  await expect(page.locator('#color-pick-menu')).toBeVisible();
  await page.locator('[data-color-mode="frozen"]').click();
  await expect.poll(async()=>{const windows=app.windows();return windows.filter(window=>window.url().includes('view=color-freeze')).length;},{timeout:15000}).toBeGreaterThan(0);
  const windows=app.windows();const freeze=windows.find(window=>window.url().includes('view=color-freeze'));
  assert.ok(freeze);
  await expect(freeze.locator('#color-freeze-surface')).toBeVisible({timeout:10000});
  const style=await freeze.locator('#color-freeze-surface').evaluate(element=>({background:getComputedStyle(element).backgroundColor,cursor:getComputedStyle(element).cursor}));
  assert.deepEqual(style,{background:'rgba(0, 0, 0, 0)',cursor:'crosshair'});
  const loupe=windows.find(window=>window.url().includes('view=color-picker'));
  assert.ok(loupe);
  await expect(loupe.locator('#loupe-freeze-hint')).toHaveText('Space 恢复');
  console.log(JSON.stringify({result:'PASS',style}));
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
