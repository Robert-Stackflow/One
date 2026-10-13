const {_electron:electron,expect}=require('@playwright/test');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
(async()=>{
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'model-ui-'));
  const profile=path.join(directory,'profile'),input=path.join(directory,'input.png'),errors=[];let app,imported=false;
  async function choose(page,id,label){await page.locator('#'+id).click();await page.getByRole('option',{name:label,exact:true}).click();}
  async function open(){
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_INFERENCE_MONITOR:path.resolve('work/current/capture-reconstruction/One.Monitor.Devices.exe')};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});
    const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one);
    await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},input);
    await home.locator('[data-page=materials]').click();if(!imported){await home.getByRole('button',{name:'导入图片',exact:true}).click();imported=true;}
    await expect(home.locator('#material-results .asset-card')).toHaveCount(1);
    const opening=app.waitForEvent('window',{predicate:async page=>{try{await page.waitForURL('**view=recognition',{timeout:5000});return true;}catch{return false;}}});
    void opening.catch(()=>{});await home.getByRole('button',{name:'识别文字',exact:true}).click();const page=await opening;
    page.on('pageerror',error=>errors.push(String(error)));await page.waitForURL('**view=recognition');
    await expect(page.locator('#run')).toBeEnabled();return page;
  }
  try{
    await build({entryPoints:['tests/local-model-ui-prepare.ts'],outfile:path.join(directory,'prepare.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    await execFile(process.execPath,[path.join(directory,'prepare.mjs')],{env:{...process.env,ONE_MODEL_UI_PROFILE:profile},windowsHide:true,maxBuffer:64*1024});
    await sharp(Buffer.from('<svg width="680" height="120"><rect width="680" height="120" fill="white"/><text x="15" y="85" font-family="Arial" font-size="58">ONE OCR 2026</text></svg>')).png().toFile(input);
    let page=await open();assert.equal((await page.evaluate(()=>window.one.recognition.state())).modelTitle,'Tesseract fast');
    await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');await expect(dialog).toBeVisible();
    await page.locator('[data-select-model=pp-ocrv6-tiny]').click();
    await choose(page,'local-model-device','CPU');
    await page.locator('#local-model-save').click();await expect(page.locator('#local-model-error')).toHaveText('已保存，将用于新任务');
    await page.locator('#local-model-settings-close').click();await page.locator('#run').click();
    await expect(page.locator('#result')).toHaveValue(/ONE\s*OCR\s*2026/,{timeout:30000});await expect(page.locator('#local-model-configure')).toHaveAttribute('data-tooltip',/PP-OCRv6 tiny · CPU/);
    // Switching a selection while a task is active must not change that task's snapshot.
    await page.evaluate(()=>{window.currentModelTask=window.one.recognition.run((document.querySelector('#source').src).split('/').pop(),'eng').then(result=>({result}),error=>({error:String(error)}));});
    const active=await page.evaluate(()=>window.one.recognition.state());assert.equal(active.running,true);
    await page.evaluate(async()=>{const api=window.one.recognition,state=await api.localModels();await api.saveLocalModel('ocr',{modelId:'tesseract',device:{mode:'auto'}},state.revision);});
    const fixed=await page.evaluate(()=>window.currentModelTask);assert.equal(fixed.result.inference.model,'PP-OCRv6 tiny');
    await page.locator('#local-model-configure').click();await page.locator('[data-select-model=pp-ocrv6-tiny]').click();
    await page.locator('#local-model-devices').click();await expect(page.locator('#local-model-error')).toHaveText('显卡列表已更新',{timeout:15000});
    await expect(page.locator('#local-model-gpu')).toContainText('NVIDIA');await expect(page.locator('#local-model-note')).toHaveCount(0);await expect(page.locator('#local-model-save-note')).toHaveCount(0);const devices=await page.evaluate(()=>window.one.recognition.localModels());assert.ok(devices.devices.gpus.some(gpu=>gpu.vendorId===4098));
    const amd=devices.devices.gpus.find(gpu=>gpu.vendorId===4098&&gpu.d3d12);
    await choose(page,'local-model-device','GPU · DirectML');
    await page.locator('#local-model-gpu').click();await page.getByRole('option',{name:amd.name+' · '+amd.deviceId,exact:true}).click();
    await page.locator('#local-model-save').click();await expect(page.locator('#local-model-error')).toHaveText('已保存，将用于新任务');
    await page.locator('#local-model-settings-close').click();await page.locator('#run').click();await expect(page.locator('#local-model-configure')).toHaveAttribute('data-tooltip',/AMD Radeon/,{timeout:30000});
    await page.locator('#local-model-configure').click();await expect(page.locator('#local-model-gpu-info')).toContainText('DXGI '+amd.deviceId);await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=recognition'));window.setSize(680,740);});
    const home=app.windows().find(window=>window.url().endsWith('?view=main'));await home.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(page.locator('#app')).toHaveAttribute('data-capture-scale','150');
    await expect(dialog).toBeVisible();const overflow=await dialog.evaluate(element=>{const body=element.querySelector('.one-dialog-body'),rect=element.getBoundingClientRect();return {scroll:body.scrollWidth,width:body.clientWidth,top:rect.top,bottom:rect.bottom,height:innerHeight};});assert.ok(overflow.scroll<=overflow.width+1&&overflow.top>=0&&overflow.bottom<=overflow.height+1,JSON.stringify(overflow));
    await page.locator('#local-model-settings').evaluate(async dialog=>{await Promise.allSettled(dialog.getAnimations({subtree:true}).map(animation=>animation.finished));});
    await page.screenshot({path:path.join(root,'local-model-management.png')});
    await expect(dialog.locator('h2')).toHaveText('OCR 模型');await expect(dialog.locator('[data-purpose]')).toHaveCount(0);await expect(dialog.locator('[data-select-model=migan-pipeline-v2]')).toHaveCount(0);
    assert.equal(await dialog.locator('#local-model-delete').evaluate(node=>!!node.closest('.model-detail-heading')),true);
    await dialog.locator('[data-select-model=tesseract]').click();
    await page.locator('#local-model-device').click();await expect(page.getByRole('option',{name:'GPU · DirectML',exact:true})).toHaveAttribute('aria-disabled','true');
    await page.keyboard.press('Escape');
    await page.locator('#local-model-settings-close').click();await app.close();app=undefined;
    page=await open();assert.equal((await page.evaluate(()=>window.one.recognition.state())).modelTitle,'PP-OCRv6 tiny');
    const persisted=await page.evaluate(()=>window.one.recognition.localModels());assert.equal(persisted.choices.ocr.device.gpu,amd.id);assert.equal(persisted.choices.ocr.device.mode,'gpu');
    await page.evaluate(async()=>{const api=window.one.recognition,state=await api.state();window.cancelledModelTask=api.run(state.token,'eng').then(()=>'',error=>String(error));await api.cancel();});
    const cancellation=await page.evaluate(()=>window.cancelledModelTask);assert.match(cancellation,/取消/);
    const initial=await page.evaluate(()=>window.one.recognition.localModels());await page.evaluate(async revision=>window.one.recognition.saveLocalModel('ocr',{modelId:'tesseract',device:{mode:'cpu'}},revision),initial.revision);
    await page.evaluate(()=>window.one.recognition.deleteLocalModel('pp-ocrv6-tiny'));
    const removed=await page.evaluate(()=>window.one.recognition.localModels(true));assert.equal(removed.entries.find(entry=>entry.id==='pp-ocrv6-tiny').ready,false);
    assert.deepEqual(errors,[]);console.log('model management UI: CPU/AMD GPU OCR, task snapshots, persisted choice, cancellation, delete and narrow layout passed');
  }finally{
    await app?.close();const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('model-ui-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
