const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const koffi=require('koffi');

async function main(){
 const user=koffi.load('user32.dll');
 const wheel=user.func('void __stdcall mouse_event(uint32 flags,uint32 dx,uint32 dy,uint32 data,uintptr_t extra)');
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-color-zoom-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.locator('[data-page="color"]').click();
  await expect(page.locator('#color-wheel-zoom')).not.toBeChecked();
  const disabledOpened=app.waitForEvent('window');await page.locator('#start-color').click();const disabledLoupe=await disabledOpened;
  await expect(disabledLoupe.locator('.live-loupe')).toBeVisible();
  await expect(disabledLoupe.locator('#loupe-zoom-hint')).toBeHidden();
  wheel(0x0800,0,0,120,0);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal((await disabledLoupe.evaluate(()=>window.one.colorCapture())).zoomFrozen,false,'disabled wheel zoom leaves picker in live mode');
  assert.equal((await app.windows()).some(window=>window.url().includes('view=color-zoom')),false,'disabled wheel zoom opens no window');
  await disabledLoupe.evaluate(()=>window.one.closeWindow()).catch(error=>{if(!disabledLoupe.isClosed())throw error;});
  await expect.poll(()=>disabledLoupe.isClosed()).toBe(true);
  await page.locator('#color-wheel-zoom').click();await expect(page.locator('#color-wheel-zoom')).toBeChecked();
  const opened=app.waitForEvent('window');await page.locator('#start-color').click();const loupe=await opened;
  await expect(loupe.locator('.live-loupe')).toBeVisible();
  const zoomOpened=app.waitForEvent('window');
  wheel(0x0800,0,0,120,0);
  const zoom=await zoomOpened;
  await expect(zoom.locator('.color-zoom-frame')).toBeVisible();
  await expect(loupe.locator('#loupe-zoom-hint')).toHaveText('局部放大 · 滚轮缩小恢复');
  const panel=await zoom.locator('.color-zoom-frame').evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}));
  assert.ok(panel.width>=290&&panel.width<=310&&panel.height>=290&&panel.height<=310);
  const card=await loupe.locator('.live-loupe').evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}));
  assert.deepEqual(card,{width:200,height:260});
  const zoomed=await loupe.evaluate(()=>window.one.colorCapture());
  assert.equal(zoomed.zoomFrozen,true);assert.equal(zoomed.pixels,41);
  const render=await zoom.locator('#color-zoom-canvas').evaluate(canvas=>{const d=canvas.getContext('2d').getImageData(150,150,1,1).data;return [...d];});
  assert.equal(render[3],255,'independent zoom window renders opaque pixels');
  if(process.env.ONE_ZOOM_SCREENSHOT)await zoom.screenshot({path:process.env.ONE_ZOOM_SCREENSHOT});
  wheel(0x0800,0,0,0xffffff88,0);
  await expect(loupe.locator('#loupe-zoom-hint')).toHaveText('滚轮局部放大');
  await expect.poll(()=>zoom.isClosed()).toBe(true);
  const restored=await loupe.evaluate(()=>window.one.colorCapture());
  assert.equal(restored.zoomFrozen,false);assert.equal(restored.pixels,11);
  console.log(JSON.stringify({result:'PASS',zoomed:zoomed.pixels,restored:restored.pixels}));
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
