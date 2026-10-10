const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtures}=require('./image-preview-fixtures.cjs');
async function run(){
 const output=path.resolve('work/current/image-preview/ui'),dir=path.join(output,'files');await fixtures(dir);
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env:{...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(output,'profile')},timeout:30000});
 const errors=[],checks=[];app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);await main.evaluate(()=>window.one.patchSettings({preview:{held:true,pinned:false,files:false}}));
  const opening=app.waitForEvent('window',{predicate:p=>p.url().includes('view=preview')});await main.evaluate(p=>window.one.preview(p),path.join(dir,'still.png'));const page=await opening;
  await expect(page.locator('.photo-visual img')).toBeVisible();
  await page.evaluate(()=>{const Original=ImageDecoder;window.__imageDecoders=new Set();window.ImageDecoder=class extends Original{constructor(options){super(options);window.__imageDecoders.add(this);}close(){window.__imageDecoders.delete(this);super.close();}};});
  const select=async name=>{await page.evaluate(p=>window.one.selectPreview(p),path.join(dir,name));await expect(page.locator('#preview-name')).toHaveText(name);};
  const pixel=()=>page.locator('canvas.animated-image').evaluate(c=>Array.from(c.getContext('2d').getImageData(2,2,1,1).data).join(','));
  for(const name of ['loop.gif','loop.apng','loop.webp']){
   await select(name);await expect(page.locator('#image-play')).toBeVisible();await expect(page.locator('canvas.animated-image')).toBeVisible();
   const colors=new Set();for(let i=0;i<10;i++){colors.add(await pixel());await page.waitForTimeout(100);}assert.ok(colors.size>=3,name+' frames');
   await page.locator('#image-play').click();await expect(page.locator('#image-play')).toHaveAttribute('aria-label','播放动画');const paused=await pixel();await page.waitForTimeout(450);assert.equal(await pixel(),paused,name+' pause');
   await page.locator('#image-restart').click();await expect(page.locator('#image-play')).toHaveAttribute('aria-label','暂停动画');
   await expect.poll(pixel).toBe('240,60,60,255');
   await page.locator('#image-play').click();await page.locator('#zoom-in').click();assert.ok(await page.locator('canvas.animated-image').evaluate(c=>c.getBoundingClientRect().width>96));checks.push(name+': three frames, pause, restart, zoom');
   const original=await page.evaluate(async()=>{const d=await window.one.previewData();return {url:d.url,display:await window.one.previewDisplayImage(d.url,128,128)};});assert.equal(original.display,original.url,name+' original animation retained');
  }
  await select('once.gif');await expect(page.locator('#image-play')).toHaveAttribute('aria-label','播放动画');assert.equal(await pixel(),'60,100,240,255');await page.locator('#image-play').click();await expect.poll(pixel).toBe('240,60,60,255');checks.push('finite GIF stops and replays');
  for(const name of ['google-old.jpg','google-container.jpg','samsung-sef.jpg','samsung-mpv2.jpg','vendor-trailer.jpg','apple-pair.jpg']){
   await select(name);await expect(page.locator('#image-motion')).toBeVisible();await page.locator('#image-motion').click();await expect(page.locator('video.motion-photo-video')).toBeVisible();
   await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(.15);assert.equal(await page.locator('video').evaluate(v=>v.muted),true);
   await expect(page.locator('video')).toBeHidden({timeout:5000});checks.push(name+': playback and return to still');
  }
  await select('heic-motion.heic');await expect(page.locator('.photo-visual canvas')).toBeVisible({timeout:10000});await expect(page.locator('#preview-details-list')).toContainText('使用动态片段画面');await page.locator('#image-motion').click();await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(.15);const oldVideo=await page.locator('video').elementHandle();
  await select('loop.gif');assert.equal(await oldVideo.evaluate(v=>v.paused&&!v.hasAttribute('src')),true);await expect(page.locator('#image-play')).toBeVisible();await select('still.png');await expect(page.locator('.photo-visual img')).toBeVisible();await expect(page.locator('#preview-image-controls')).toBeEmpty();assert.equal(await page.evaluate(()=>window.__imageDecoders.size),0);checks.push('HEIC movie-frame fallback, video and decoder release');
  await fs.writeFile(path.join(dir,'broken.gif'),'broken');await select('broken.gif');await expect(page.locator('.image-preview-hint')).toBeVisible();await select('still.png');checks.push('corrupt image recovery');
  await select('motion-missing.jpg');await expect(page.locator('.photo-visual img')).toBeVisible();await expect(page.locator('#preview-status-kind')).toHaveText('仅静态照片');await expect(page.locator('#preview-status-kind')).toHaveAttribute('data-tooltip',/未找到可播放/);await expect(page.locator('#preview-image-controls')).toBeEmpty();checks.push('motion marker without video is explicitly reported');
  await select('metadata.jpg');await page.locator('#preview-files').click();await page.locator('#side-details').click();await expect(page.locator('#preview-details-list')).toContainText('已闪光 · 自动 · 防红眼');await expect(page.locator('#preview-details-list')).toContainText('2025-10-06 09:20:35.125 +08:00');await expect(page.locator('#preview-details-list')).toContainText('拍摄位置');await expect(page.locator('#preview-details-list')).toContainText('33.866667° S');
  await app.evaluate(({app,shell})=>{shell.openExternal=async url=>{app.__photoMapURL=url;};});await page.locator('.photo-map-link').click();await expect.poll(()=>app.evaluate(({app})=>app.__photoMapURL||'')).toContain('https://www.openstreetmap.org/?mlat=-33.866');checks.push('photo details and explicit map action');
  assert.deepEqual(errors,[]);await fs.mkdir('verification/image-preview',{recursive:true});await fs.writeFile('verification/image-preview/latest.json',JSON.stringify({date:new Date().toISOString(),checks,errors,scope:'Generated images and synthetic phone containers, H.264 playback. No real phone/HEVC/HEIC still codec certification.'},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
