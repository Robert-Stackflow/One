const {_electron:electron,expect}=require('@playwright/test');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
(async()=>{
  const presets=process.argv.includes('--presets'),selectionCase=process.argv.includes('--selection'),timing=process.argv.includes('--timing'),rasterCase=process.argv.includes('--raster'),formulaRaster=process.argv.includes('--formula-raster'),longImage=process.argv.includes('--long')||rasterCase;
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'model-ui-'));
  const profile=path.join(directory,'profile'),input=path.join(directory,'input.png'),errors=[];let app,imported=false;
  async function choose(page,id,label){await page.locator('#'+id).click();await page.getByRole('option',{name:label,exact:true}).click();}
  async function open(){
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_INFERENCE_MONITOR:path.resolve('work/current/capture-reconstruction/One.Monitor.Devices.exe')};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});
    if(rasterCase||formulaRaster)await app.evaluate(({app})=>{global.__originalRasterRequests=[];app.on('web-contents-created',(_event,contents)=>{contents.session.webRequest.onBeforeRequest({urls:['one-file://recognition/*','one-file://formula-recognition/*']},(details,callback)=>{global.__originalRasterRequests.push(details.url);callback({});});});});
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
    await execFile(process.execPath,[path.join(directory,'prepare.mjs')],{env:{...process.env,ONE_MODEL_UI_PROFILE:profile,...(presets?{ONE_MODEL_UI_PRESETS:'1'}:{})},windowsHide:true,maxBuffer:64*1024});
    await sharp(Buffer.from('<svg width="680" height="120"><rect width="680" height="120" fill="white"/><text x="15" y="85" font-family="Arial" font-size="58">ONE OCR 2026</text></svg>')).png().toFile(input);
    if(longImage)await sharp(Buffer.from(`<svg width="680" height="10000"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="42">${[100,1806,3596,5390,7185,8976,9800].map((y,index)=>`<text x="24" y="${y}">ONE ROW ${index+1} END</text>`).join('')}</g></svg>`)).png().toFile(input);
    if(rasterCase)await sharp(Buffer.from('<svg width="2400" height="16000"><rect x="0" y="7500" width="2400" height="1000" fill="red" fill-opacity=".5"/></svg>')).png().toFile(input);
    if(formulaRaster)await sharp(Buffer.from('<svg width="3000" height="1800"><rect width="3000" height="1800" fill="red" fill-opacity=".5"/></svg>')).png().toFile(input);
    let page=await open();assert.equal((await page.evaluate(()=>window.one.recognition.state())).modelTitle,'Tesseract fast');
    if(formulaRaster){
      const original=await page.evaluate(()=>window.one.recognition.state()),opening=app.waitForEvent('window');
      await page.locator('#open-formula').click();page=await opening;await page.waitForURL('**view=formula-recognition');page.on('pageerror',error=>errors.push(String(error)));
      await expect(page.locator('#source')).toHaveAttribute('data-virtualized','true');await expect(page.locator('.recognition-image-placeholder')).toHaveCount(0);
      const natural=await page.locator('#source').evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight}));assert.deepEqual(natural,{width:1000,height:600});
      for(let step=0;step<4;step++)await page.locator('[data-text-action=zoom-in]').click();
      await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/);await page.locator('[data-text-action=rotate]').click();await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/);
      await assert.rejects(page.evaluate(token=>window.one.formulaRecognition.imagePreview(token,{view:100,left:0,top:0,width:10,height:10,downsample:1}),original.token),/失效/);
      assert.deepEqual(await app.evaluate(()=>global.__originalRasterRequests),[]);assert.deepEqual(errors,[]);
      console.log('formula raster: bounded preview, detail zoom/rotation and separate source-token scope passed');return;
    }
    if(rasterCase){
      await expect(page.locator('#source')).toHaveAttribute('data-virtualized','true');
      await expect(page.locator('.recognition-image-placeholder')).toHaveCount(0);
      const natural=await page.locator('#source').evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight}));assert.ok(natural.height<=1024&&natural.width<=1024);
      for(let step=0;step<8;step++)await page.locator('[data-text-action=zoom-in]').click();
      await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/,{timeout:15000});
      async function sample(){const box=await page.locator('.text-image-viewport').boundingBox();return [...await sharp(await page.screenshot({clip:{x:Math.floor(box.x+box.width/2),y:Math.floor(box.y+box.height/2),width:1,height:1}})).removeAlpha().raw().toBuffer()];}
      const detail=await sample();
      assert.ok(detail[0]>detail[1]+40&&detail[0]>detail[2]+40,'the viewport center shows the red source patch');
      for(const sourcePoint of [{x:2048,y:8000},{x:1200,y:8192}]){
        const point=await page.evaluate(({x,y})=>{const inner=document.querySelector('.text-image-inner'),stage=document.querySelector('.text-image-stage').getBoundingClientRect(),scale=parseFloat(inner.style.width)/2400,p=new DOMPoint(x*scale,y*scale).matrixTransform(new DOMMatrix(getComputedStyle(inner).transform));return {x:stage.left+p.x,y:stage.top+p.y};},sourcePoint);
        const pixels=await sharp(await page.screenshot({clip:{x:Math.floor(point.x)-1,y:Math.floor(point.y)-1,width:3,height:3}})).removeAlpha().raw().toBuffer();
        assert.ok([...pixels].every((channel,index)=>Math.abs(channel-detail[index%3])<=3),'resampling context must not introduce a visible tile seam');
      }
      await page.evaluate(()=>{document.querySelector('.text-image-inner').classList.remove('image-detail-ready');document.querySelector('.text-image-tiles').hidden=true;});
      const preview=await sample();assert.ok(detail.every((channel,index)=>Math.abs(channel-preview[index])<=3),'transparent detail replaces the preview without doubled alpha');
      await page.locator('[data-text-action=rotate]').click();await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/);
      const rotated=await sample();assert.ok(detail.every((channel,index)=>Math.abs(channel-rotated[index])<=3),'rotation retains the same source center');
      const bitmaps=await page.locator('.text-image-tile img').evaluateAll(images=>images.map(image=>({width:image.naturalWidth,height:image.naturalHeight})));
      assert.ok(bitmaps.length>0&&bitmaps.length<=64&&bitmaps.every(image=>image.width<=1024&&image.height<=1024));
      await page.evaluate(()=>{window.__rasterURLs=new Set();window.__rasterPeak=0;const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);window.__rasterURLs.add(url);window.__rasterPeak=Math.max(window.__rasterPeak,window.__rasterURLs.size);return url;};URL.revokeObjectURL=url=>{window.__rasterURLs.delete(url);revoke(url);};});
      for(let turn=0;turn<3;turn++)await page.locator('[data-text-action=rotate]').click();
      for(let step=0;step<8;step++)await page.locator('[data-text-action=zoom-in]').click();
      for(const y of [512,2560,4608,6656,8704,10752,12800,14848])for(const x of [256,1280,2200]){
        await page.locator('.text-image-viewport').evaluate(async(node,{x,y})=>{const stage=node.querySelector('.text-image-stage'),scale=parseFloat(node.querySelector('.text-image-inner').style.width)/2400;node.scrollLeft=stage.offsetLeft+x*scale-node.clientWidth/2;node.scrollTop=stage.offsetTop+y*scale-node.clientHeight/2;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},{x,y});
        await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/,{timeout:15000});
      }
      const cachePeak=await page.evaluate(()=>window.__rasterPeak);assert.ok(cachePeak<=68,'decoded tile cache plus four in-flight images stays bounded');
      await assert.rejects(page.evaluate(()=>window.one.recognition.imagePreview('wrong',{view:0,left:0,top:0,width:10,height:10,downsample:1})),/失效/);
      assert.deepEqual(await app.evaluate(()=>global.__originalRasterRequests),[],'browser must never fetch the full-resolution original');
      await app.evaluate(({ipcMain})=>{global.__previewFailures=0;const channel='one:recognition-image-preview';ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>{global.__previewFailures++;throw Error('preview failure fixture');});});
      await page.locator('[data-text-action=fit]').click();for(let step=0;step<5;step++)await page.locator('[data-text-action=zoom-in]').click();
      await expect.poll(()=>app.evaluate(()=>global.__previewFailures)).toBeGreaterThan(0);
      await new Promise(resolve=>setTimeout(resolve,700));const failureReads=await app.evaluate(()=>global.__previewFailures);
      await new Promise(resolve=>setTimeout(resolve,700));assert.equal(await app.evaluate(()=>global.__previewFailures),failureReads,'failed tiles do not create an automatic request loop');
      assert.deepEqual(errors,[]);console.log(JSON.stringify({virtualized:true,natural,visibleTiles:bitmaps.length,cachePeak,transparentAlphaPreserved:true,rotation:true,originalRequests:0,failureReads}));return;
    }
    if(longImage){
      await app.evaluate(({clipboard})=>{global.__longCopied='';clipboard.writeText=value=>{global.__longCopied=value;};});
      const info=await page.evaluate(()=>window.one.recognition.state());assert.equal(info.height,10000);
      await page.locator('#run').click();await expect(page.locator('#result')).toHaveValue(/ONE ROW 7 END/,{timeout:60000});
      const text=await page.locator('#result').inputValue();assert.equal((text.match(/ONE ROW/g)||[]).length,7);
      await page.locator('#copy').click();assert.equal(await app.evaluate(()=>global.__longCopied),text);
      await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');
      await dialog.locator('[data-select-model=pp-ocrv6-tiny]').click();await choose(page,'local-model-device','CPU');
      await dialog.locator('#local-model-save').click();await expect(dialog).not.toBeVisible();
      await page.locator('#run').click();await page.evaluate(()=>window.one.recognition.cancel());await expect(page.locator('#run')).toBeEnabled();
      assert.equal((await page.evaluate(()=>window.one.recognition.state())).image,info.image,'cancel preserves the original image');
      await app.evaluate(({ipcMain})=>{const channel='one:recognition-run',previous=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{const result=await previous(...args);global.__longResult=result;return result;});});
      await page.locator('#run').click();
      await expect(page.locator('#run')).toBeEnabled({timeout:60000});await expect(page.locator('#result')).toHaveValue(/ONE ROW 7 END/);
      const selected=await app.evaluate(()=>global.__longResult);
      assert.equal(((await page.locator('#result').inputValue()).match(/ONE ROW/g)||[]).length,7);
      assert.equal(selected.document.source.height,10000);assert.ok(selected.words.some(word=>word.y>9000));
      const tokens=selected.document.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens));assert.ok(tokens.some(token=>token.geometry==='ctc'&&token.quad[0].y>9000));
      await expect(page.locator('#source')).toHaveAttribute('data-virtualized','true');
      for(let step=0;step<12;step++)await page.locator('[data-text-action=zoom-in]').click();
      await page.locator('.text-image-viewport').evaluate(async node=>{const stage=node.querySelector('.text-image-stage'),scale=parseFloat(node.querySelector('.text-image-inner').style.width)/680;node.scrollLeft=stage.offsetLeft+70*scale-node.clientWidth/2;node.scrollTop=stage.offsetTop+5370*scale-node.clientHeight/2;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/,{timeout:15000});
      const firstO=page.locator('.text-selection-unit[data-geometry=ctc]').filter({hasText:/^O$/}).first();
      let glyph=await firstO.boundingBox();assert.ok(glyph);await page.mouse.click(glyph.x+glyph.width/2,glyph.y+glyph.height/2);
      await page.getByRole('button',{name:'复制选中文字',exact:true}).click();assert.equal(await app.evaluate(()=>global.__longCopied),'O');
      await page.locator('[data-text-action=rotate]').click();await expect(page.locator('.text-image-inner')).toHaveClass(/image-detail-ready/);
      glyph=await firstO.boundingBox();assert.ok(glyph);await page.mouse.click(glyph.x+glyph.width/2,glyph.y+glyph.height/2);
      await page.getByRole('button',{name:'复制选中文字',exact:true}).click();assert.equal(await app.evaluate(()=>global.__longCopied),'O');
      assert.deepEqual(errors,[]);console.log('long-image window: 10000px Tesseract/Paddle OCR, full copy, cancel/retry, preserved source and global CTC coordinates passed');return;
    }
    if(timing){
      await app.evaluate(({ipcMain})=>{
        const channel='one:recognition-local-models',previous=ipcMain._invokeHandlers.get(channel);
        global.__modelReads=[];global.__modelWait=new Promise(resolve=>{global.__releaseModels=resolve;});
        ipcMain.removeHandler(channel);ipcMain.handle(channel,async(...args)=>{
          await global.__modelWait;const start=performance.now();const value=await previous(...args);
          global.__modelReads.push(performance.now()-start);return value;
        });
      });
      const firstFrame=await page.evaluate(()=>new Promise(resolve=>{
        const start=performance.now();document.querySelector('#local-model-configure').click();
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          const dialog=document.querySelector('#local-model-settings');
          resolve({milliseconds:performance.now()-start,open:dialog.open,loading:!dialog.querySelector('#local-model-loading').hidden,width:dialog.getBoundingClientRect().width});
        }));
      }));
      assert.ok(firstFrame.open&&firstFrame.loading&&firstFrame.width>0,'dialog paints before model metadata completes');
      assert.ok(firstFrame.milliseconds<500,'first dialog frame is independent of blocked backend');
      assert.deepEqual(await app.evaluate(()=>global.__modelReads),[]);
      await app.evaluate(()=>global.__releaseModels());
      await expect(page.locator('[data-select-model=tesseract]')).toBeVisible();
      const metadataMilliseconds=await app.evaluate(()=>global.__modelReads);
      const evidence={firstFrame,metadataMilliseconds,pageErrors:errors};
      await fs.writeFile(path.join(root,'model-dialog-timing.json'),JSON.stringify(evidence,null,2));
      assert.deepEqual(errors,[]);console.log(JSON.stringify(evidence));return;
    }
    if(selectionCase){
      await app.evaluate(({clipboard})=>{global.__ctcCopied='';clipboard.writeText=value=>{global.__ctcCopied=value;};});
      await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');
      await dialog.locator('[data-select-model=pp-ocrv6-tiny]').click();await choose(page,'local-model-device','CPU');
      await expect(dialog.locator('#local-model-metadata')).toContainText('近似字级（CTC）');
      await dialog.locator('#local-model-save').click();await expect(dialog).not.toBeVisible();await page.locator('#run').click();
      await expect(page.locator('#result')).toHaveValue(/ONE\s*OCR\s*2026/,{timeout:30000});
      const units=page.locator('.text-selection-unit[data-geometry=ctc]');await expect.poll(()=>units.count()).toBeGreaterThan(8);
      const first=units.filter({hasText:/^O$/}).first();await expect(first).toHaveAttribute('aria-label',/位置近似/);
      let box=await first.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
      const copy=page.getByRole('button',{name:'复制选中文字',exact:true});await expect(copy).toBeVisible();await copy.click();
      assert.equal(await app.evaluate(()=>global.__ctcCopied),'O');
      await page.locator('.text-image-viewport').focus();await page.keyboard.press('Shift+ArrowRight');await copy.click();
      assert.equal(await app.evaluate(()=>global.__ctcCopied),'ON');
      assert.equal(await page.locator('#result').evaluate(node=>node.value.slice(node.selectionStart,node.selectionEnd)),'ON');
      const screenshot=await page.screenshot();await sharp(screenshot).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(root,'ctc-selection-review.png'));
      await page.locator('[data-text-action=rotate]').click();box=await first.boundingBox();assert.ok(box);
      await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await copy.click();assert.equal(await app.evaluate(()=>global.__ctcCopied),'O');
      await page.locator('.text-image-viewport').focus();await page.keyboard.press('Control+a');await copy.click();
      assert.equal((await app.evaluate(()=>global.__ctcCopied)).replace(/\s/g,''),'ONEOCR2026');
      await page.locator('#result').fill('修正后的原文');await expect(page.locator('.text-selection-actions')).toBeHidden();
      assert.deepEqual(errors,[]);console.log('CTC selection UI: approximate metadata, character copy, keyboard expansion/editor sync, rotation, select-all and stale geometry disable passed');return;
    }
    if(presets){
      for(const id of ['pp-ocrv6-small','pp-ocrv6-medium']){
        await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');
        await dialog.locator(`[data-select-model=${id}]`).click();await choose(page,'local-model-device','CPU');
        await dialog.locator('#local-model-save').click();await expect(dialog).not.toBeVisible();
        const state=await page.evaluate(()=>window.one.recognition.localModels());assert.equal(state.choices.ocr.modelId,id);
        const revision=state.entries.find(entry=>entry.id===id).revision;
        for(let run=0;run<(id.endsWith('medium')?2:1);run++){
          const result=await page.evaluate(async()=>{const api=window.one.recognition,state=await api.state();return api.run(state.token,'eng');});
          assert.match(result.text,/ONE\s*OCR\s*2026/);assert.equal(result.document.engine.model,revision);
          assert.equal(result.inference.model,'PP-OCRv6 '+id.split('-').at(-1));assert.equal(result.inference.backend,'cpu');
        }
      }
      assert.deepEqual(errors,[]);console.log('model preset UI: small/medium apply-close, exact model revisions and medium warm CPU budget passed');return;
    }
    await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');await expect(dialog).toBeVisible();await expect(dialog.locator('[data-select-model=tesseract] .model-current')).toBeVisible();
    await page.locator('[data-select-model=pp-ocrv6-tiny]').click();await expect(dialog.locator('[data-select-model=tesseract] .model-current')).toBeVisible();await expect(dialog.locator('[data-select-model=pp-ocrv6-tiny] .model-current')).not.toBeVisible();
    await choose(page,'local-model-device','CPU');
    await page.locator('#local-model-save').click();await expect(page.locator('[data-select-model=pp-ocrv6-tiny]')).toHaveAttribute('aria-current','true');await expect(page.locator('#local-model-save')).toBeEnabled();await expect(page.locator('#local-model-error')).not.toBeVisible();
    await expect(dialog).not.toBeVisible();await page.locator('#run').click();
    await expect(page.locator('#result')).toHaveValue(/ONE\s*OCR\s*2026/,{timeout:30000});await expect(page.locator('#local-model-configure')).toHaveAttribute('data-tooltip',/PP-OCRv6 tiny · CPU/);
    // Switching a selection while a task is active must not change that task's snapshot.
    await page.evaluate(()=>{window.currentModelTask=window.one.recognition.run((document.querySelector('#source').src).split('/').pop(),'eng').then(result=>({result}),error=>({error:String(error)}));});
    const active=await page.evaluate(()=>window.one.recognition.state());assert.equal(active.running,true);
    await page.evaluate(async()=>{const api=window.one.recognition,state=await api.localModels();await api.saveLocalModel('ocr',{modelId:'tesseract',device:{mode:'auto'}},state.revision);});
    const fixed=await page.evaluate(()=>window.currentModelTask);assert.equal(fixed.result.inference.model,'PP-OCRv6 tiny');
    await page.locator('#local-model-configure').click();await page.locator('[data-select-model=pp-ocrv6-tiny]').click();
    await page.locator('#local-model-devices').click();await expect(page.locator('#local-model-devices')).toBeEnabled({timeout:15000});await expect(page.locator('#local-model-error')).not.toBeVisible();
    await expect(page.locator('#local-model-gpu')).toContainText('NVIDIA');await expect(page.locator('#local-model-note')).toHaveCount(0);await expect(page.locator('#local-model-save-note')).toHaveCount(0);const devices=await page.evaluate(()=>window.one.recognition.localModels());assert.ok(devices.devices.gpus.some(gpu=>gpu.vendorId===4098));
    const amd=devices.devices.gpus.find(gpu=>gpu.vendorId===4098&&gpu.d3d12);
    await choose(page,'local-model-device','GPU · DirectML');
    await page.locator('#local-model-gpu').click();await page.getByRole('option',{name:amd.name+' · '+amd.deviceId,exact:true}).click();
    await page.locator('#local-model-save').click();await expect(page.locator('[data-select-model=pp-ocrv6-tiny]')).toHaveAttribute('aria-current','true');await expect(page.locator('#local-model-save')).toBeEnabled();await expect(page.locator('#local-model-error')).not.toBeVisible();
    await expect(dialog).not.toBeVisible();await page.locator('#run').click();await expect(page.locator('#local-model-configure')).toHaveAttribute('data-tooltip',/AMD Radeon/,{timeout:30000});
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
