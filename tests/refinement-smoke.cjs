const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const output=path.resolve('work/refinement-smoke');await fs.mkdir(output,{recursive:true});
  const profile=await fs.mkdtemp(path.join(output,'profile-'));const files=await fs.mkdtemp(path.join(output,'files-'));
  await fs.writeFile(path.join(files,'01.txt'),'One\n预览与窗口交互\n文件内容保持原样');await fs.writeFile(path.join(files,'02.txt'),'第二个文件');await fs.writeFile(path.join(files,'03.txt'),'第三个文件');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch(process.env.ONE_PACKAGED_EXE ? {executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env} : {args:[path.resolve('.')],env});
  const errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
  try {
    const page=await app.firstWindow();await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source');assert.equal(await page.evaluate(()=>navigator.windowControlsOverlay?.visible),false);
    await page.evaluate(()=>window.one.windowAction('maximize'));await expect(page.locator('body')).toHaveClass(/maximized/);assert.equal((await page.evaluate(()=>window.one.windowState())).maximized,true);
    await page.evaluate(()=>window.one.windowAction('maximize'));await expect(page.locator('body')).not.toHaveClass(/maximized/);
    await page.evaluate(()=>window.one.windowAction('minimize'));assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL().includes('view=main')).isMinimized()),true);
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL().includes('view=main'));w.restore();w.show();});
    await page.locator('[data-page=input]').click();await expect(page.locator('#dwellMs')).toHaveValue('650');
    await page.locator('#enhancement-tab-echo').click();
    // Check visual geometry in both states, not just the checkbox value.
    for(const checked of [false,true]) {
      await page.locator('#keyEcho').setChecked(checked);await page.waitForTimeout(200);
      const geometry=await page.locator('#keyEcho').evaluate(input=>{const label=input.parentElement.getBoundingClientRect(),track=input.nextElementSibling.getBoundingClientRect(),thumb=getComputedStyle(input.nextElementSibling,'::after');return {label:{x:label.x,y:label.y,w:label.width,h:label.height},track:{x:track.x,y:track.y,w:track.width,h:track.height},thumb:{top:parseFloat(thumb.top),left:parseFloat(thumb.left),w:parseFloat(thumb.width),h:parseFloat(thumb.height),transform:thumb.transform}};});
      assert.equal(geometry.label.y,geometry.track.y);assert.equal(geometry.label.h,geometry.track.h);assert.ok(geometry.thumb.top>=0&&geometry.thumb.top+geometry.thumb.h<=geometry.track.h);
      const translate=geometry.thumb.transform==='none'?0:Number(geometry.thumb.transform.split(',')[4]);assert.ok(translate>=0&&geometry.thumb.left+translate+geometry.thumb.w<=geometry.track.w);assert.equal(translate>0,checked);
    }
    await page.locator('#keyEcho').uncheck();
    assert.equal(await page.locator('#onlyCombinations').evaluate(e=>e.getBoundingClientRect().height),16);
    await page.locator('#enhancement-tab-edges').click();
    for(const [edge,action,step] of [['top','调节亮度',3],['right','调节音量',4],['bottom','调节亮度',5],['left','关闭',2]]) {
      await page.locator('#edge-'+edge).click();await page.getByRole('option',{name:action,exact:true}).click();
      if(action!=='关闭')await page.locator('#edge-step-'+edge).fill(String(step));
    }
    await page.locator('#page-name').click();await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).dwellMs)).toBe(Number(await page.locator('#dwellMs').inputValue()));await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).edges.bottom.step)).toBe(5);const settings=await page.evaluate(()=>window.one.settings());assert.deepEqual(settings.edges,{top:{action:'brightness',step:3},right:{action:'volume',step:4},bottom:{action:'brightness',step:5},left:{action:'off',step:2}});
    await page.locator('#check-brightness').click();await expect(page.locator('#check-brightness')).toBeEnabled({timeout:45000});await expect(page.locator('#brightness-status>div')).not.toHaveCount(0);
    const brightness=await page.locator('#brightness-status').innerText();await page.evaluate(()=>document.getElementById('toast').hidden=true);await page.locator('.content').evaluate(e=>e.scrollTop=0);await page.screenshot({animations:'disabled',path:path.join(output,'操作增强.png')});
    // Read real project metadata, including partial results and navigation while the worker runs.
    await page.locator('[data-page=disk]').click();await page.locator('#disk-path').evaluate((e,p)=>e.value=p,path.resolve('node_modules'));
    await page.evaluate(()=>{window.scanEvidence=[];window.one.onProgress(value=>window.scanEvidence.push({files:value.files,bytes:value.bytes,whileRunning:document.getElementById('scan').disabled}));});
    await page.locator('#scan').click();await expect(page.locator('#disk-size')).not.toHaveText('0 B');
    await expect(page.locator('#scan')).toBeEnabled({timeout:60000});
    const evidence=await page.evaluate(()=>window.scanEvidence);assert.ok(evidence.filter(x=>x.files>0&&x.whileRunning).length>1);assert.ok(evidence.at(-1).files>1000);
    await expect(page.locator('#disk-canvas')).toBeVisible();await page.locator('#toggle-list').click();await page.locator('#disk-rows tr').first().click();await expect(page.locator('#selection-enter')).toBeEnabled();
    await page.screenshot({path:path.join(output,'空间分析.png')});
    await page.locator('#disk-rows tr').first().press('Enter');await expect(page.locator('#breadcrumbs button')).not.toHaveCount(1);await page.locator('#disk-back').click();await expect(page.locator('#breadcrumbs button')).toHaveCount(1);
    await page.locator('#disk-filter').fill('*.json;>1kb');await expect(page.locator('#filter-state')).toContainText('匹配');await page.locator('#clear-disk-filter').click();
    await page.locator('#map-depth').click();await page.getByRole('option',{name:'3 层',exact:true}).click();await page.locator('#toggle-list').click();await expect(page.locator('.disk-inspector')).toBeHidden();await page.locator('#toggle-list').click();
    await page.locator('#disk-canvas').click({button:'right',position:{x:30,y:18}});await expect(page.locator('.disk-context')).toBeVisible();await page.locator('.disk-context button').first().press('Escape');await expect(page.locator('.disk-context')).toHaveCount(0);
    // Browse a real, larger project tree before the scan completes, then keep partial results.
    await page.locator('#disk-path').evaluate((e,p)=>e.value=p,path.resolve('.'));await page.locator('#scan').click();
    await expect(page.locator('#disk-size')).not.toHaveText('0 B');
    await expect(page.locator('#scan')).toBeDisabled();
    // Navigate and cancel in one renderer turn so a fast filesystem cannot finish during screenshot capture.
    await page.evaluate(async()=>{const row=document.querySelector('#disk-rows tr[data-directory=true]');if(!row)throw new Error('No scanned folder');row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(document.querySelectorAll('#breadcrumbs button').length<=1)throw new Error('Navigation did not apply');const stop=document.querySelector('#cancel-scan');if(stop.disabled)throw new Error('Scan completed before cancellation test');stop.click();});
    await expect(page.locator('#scan-state')).toHaveText(/已停止/,{timeout:20000});await expect(page.locator('#disk-results')).toBeVisible();await expect(page.locator('#disk-files')).not.toHaveText('0');
    const partial=await page.locator('#disk-files').innerText();await page.screenshot({path:path.join(output,'扫描部分结果.png')});
    // A second scan can start after cancellation. No stale results from the previous worker.
    await page.locator('#disk-path').evaluate((e,p)=>e.value=p,files);await page.locator('#scan').click();await expect(page.locator('#scan-state')).toHaveText('实时更新');await expect(page.locator('#disk-files')).toHaveText('3');
    // Fast completions must retain the final progress patch before the next scan starts.
    const empty=await fs.mkdtemp(path.join(output,'empty-'));
    for(const target of [empty,files,empty,files]){await page.locator('#disk-path').evaluate((e,p)=>e.value=p,target);await page.locator('#scan').click();await expect(page.locator('#scan-state')).toHaveText('实时更新');await expect(page.locator('#disk-files')).toHaveText(target===empty?'0':'3');}
    let opened=app.waitForEvent('window');await page.evaluate(file=>window.one.preview(file),path.join(files,'01.txt'));let preview=await opened;await expect(preview.locator('#preview-body pre')).toContainText('One');
    if(await preview.locator('#preview-files').getAttribute('aria-pressed')!=='true')await preview.locator('#preview-files').click();await preview.locator('#side-details').click();await expect(preview.locator('#preview-information')).toBeVisible();await expect(preview.locator('#preview-path')).toContainText('01.txt');await preview.locator('#side-files').click();
    await preview.evaluate(()=>Promise.all([window.one.navigatePreview(1),window.one.navigatePreview(1)]));await expect(preview.locator('#preview-name')).toHaveText('03.txt');await preview.locator('#preview-prev').click();await expect(preview.locator('#preview-name')).toHaveText('02.txt');
    await preview.evaluate(()=>window.one.windowAction('maximize'));await expect(preview.locator('body')).toHaveClass(/maximized/);await preview.evaluate(()=>window.one.windowAction('maximize'));await preview.screenshot({path:path.join(output,'文字预览.png')});
    await preview.close();await expect.poll(()=>preview.isClosed()).toBe(true);
    // Use a locally generated PNG screenshot to exercise real image dimensions and fit/zoom.
    const png=path.join(output,'空间分析.png');opened=app.waitForEvent('window');await page.evaluate(file=>window.one.preview(file),png);preview=await opened;await expect(preview.locator('#preview-size')).toContainText('×');await preview.locator('#zoom-reset').click();await expect(preview.locator('#zoom-reset')).toHaveText('100%');await preview.locator('#zoom-in').click();await expect(preview.locator('#zoom-reset')).toHaveText('125%');await preview.locator('#zoom-fit').click();await preview.screenshot({path:path.join(output,'图片预览.png')});await preview.close();
    const wav=Buffer.alloc(44+16000*2*3);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    const wavPath=path.join(files,'silence.wav');await fs.writeFile(wavPath,wav);opened=app.waitForEvent('window');await page.evaluate(file=>window.one.preview(file),wavPath);preview=await opened;
    await expect(preview.locator('#media-duration')).toHaveText('0:03');assert.equal(await preview.locator('audio').evaluate(e=>e.controls),false);await expect.poll(()=>preview.locator('audio').evaluate(e=>e.paused)).toBe(false);await preview.locator('#media-play').click();await expect.poll(()=>preview.locator('audio').evaluate(e=>e.paused)).toBe(true);await preview.locator('#media-mute').click();assert.equal(await preview.locator('audio').evaluate(e=>e.muted),true);await preview.screenshot({animations:'disabled',path:path.join(output,'音频预览.png')});await preview.close();
    // Compact window: no horizontal page overflow or broken switches.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL().includes('view=main')).setSize(900,700));await page.locator('[data-page=input]').click();await page.locator('.content').evaluate(e=>e.scrollTop=0);
    const overflow=await page.locator('.content').evaluate(e=>e.scrollWidth-e.clientWidth);assert.ok(overflow<=1,`horizontal overflow ${overflow}`);await page.screenshot({path:path.join(output,'紧凑窗口.png')});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',packaged:!!process.env.ONE_PACKAGED_EXE,progressBatches:evidence.length,files:evidence.at(-1).files,partialFiles:partial,brightness,output},null,2));
  } finally {await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
