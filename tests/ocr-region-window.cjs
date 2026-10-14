const {_electron:electron,expect}=require('@playwright/test');
const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
(async()=>{
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'region-window-')),profile=path.join(directory,'profile'),input=path.join(directory,'input.png');
  let app;const errors=[],long=process.argv.includes('--long'),gpu=process.argv.includes('--dml0')?0:process.argv.includes('--dml1')?1:undefined;
  async function choose(page,id,label){await page.locator('#'+id).click();await page.getByRole('option',{name:label,exact:true}).click();}
  const tokens=doc=>doc.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens)).sort((a,b)=>a.order-b.order);
  function unaffected(before,after,selection){
    const old=tokens(before.document),updated=tokens(after.document),chosen=new Set(old.slice(Math.min(selection.anchor,selection.focus),Math.max(selection.anchor,selection.focus)+1).map(token=>token.wordId));
    for(const token of old.filter(token=>!chosen.has(token.wordId))){const next=updated.find(value=>value.id===token.id);assert(next,'Unselected token lost: '+token.text);assert.deepEqual(next.quad,token.quad);assert.equal(next.text,token.text);}
    assert.equal(after.document.source.sha256,before.document.source.sha256);assert.equal(after.width,before.width);assert.equal(after.height,before.height);
    for(const token of updated)assert.equal(after.text.slice(token.sourceStart,token.sourceEnd),token.text);
  }
  try{
    await build({entryPoints:['tests/local-model-ui-prepare.ts'],outfile:path.join(directory,'prepare.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    await execFile(process.execPath,[path.join(directory,'prepare.mjs')],{env:{...process.env,ONE_MODEL_UI_PROFILE:profile},windowsHide:true,maxBuffer:65536});
    const height=long?10000:500,last=long?8600:310;
    await sharp(Buffer.from(`<svg width="680" height="${height}"><rect width="680" height="${height}" fill="white"/><text x="25" y="150" font-family="Arial" font-size="52">ONE OCR 2026</text><text x="25" y="${last}" font-family="Arial" font-size="48">KEEP THIS LINE</text></svg>`)).png().toFile(input);
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_INFERENCE_MONITOR:path.resolve('work/current/capture-reconstruction/One.Monitor.Devices.exe')};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);
    await app.evaluate(({dialog,ipcMain},input)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});global.regionResults=[];global.regionErrors=[];global.baseResult=undefined;global.regionWorkers=[];
      const threads=process.getBuiltinModule('worker_threads'),Worker=threads.Worker;
      threads.Worker=class extends Worker{constructor(file,options){super(file,options);if(String(file).endsWith('ocr-worker.cjs')){const record={active:true};global.regionWorkers.push(record);this.once('exit',()=>record.active=false);}}};
      for(const name of ['run','region']){const channel='one:recognition-'+name,old=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,async(event,...args)=>{try{const result=await old(event,...args);if(name==='run')global.baseResult=result;else global.regionResults.push({selection:args[2],result});return result;}catch(error){if(name==='region')global.regionErrors.push(String(error));throw error;}});}
    },input);
    const [asset]=await main.evaluate(()=>window.one.materialsImportImages());await main.evaluate(id=>window.one.materialsRecognizeImage(id),asset);
    const page=app.windows().find(page=>page.url().includes('view=recognition'));assert(page);await expect(page.locator('#run')).toBeEnabled();
    if(process.argv.includes('--area')){
      const paddleArea=process.argv.includes('--area-paddle');
      if(paddleArea){await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');await dialog.locator('[data-select-model=pp-ocrv6-tiny]').click();await choose(page,'local-model-device',gpu===undefined?'CPU':'GPU · DirectML');if(gpu!==undefined){await expect(page.locator('#local-model-gpu-info')).toContainText('GiB',{timeout:15000});await page.locator('#local-model-gpu').click();await page.getByRole('option',{name:new RegExp(' · '+gpu+'$')}).click();}await dialog.locator('#local-model-save').click();}
      const state=await page.evaluate(()=>window.one.recognition.state());await require('./recognition-area-window.cjs')({app,page,id:state.token,long,cancelWorker:!paddleArea,device:paddleArea?gpu:undefined});assert.deepEqual(errors,[]);return;
    }
    await page.locator('#run').click();await expect(page.locator('#result')).toHaveValue(/KEEP THIS LINE/,{timeout:60000});const original=await page.evaluate(()=>window.one.recognition.state());
    let baseline=await app.evaluate(()=>global.baseResult);
    if(long){for(let i=0;i<12;i++)await page.locator('[data-text-action=zoom-in]').click();await page.locator('.text-image-viewport').evaluate(node=>{const stage=node.querySelector('.text-image-stage'),scale=stage.querySelector('.text-image-inner').getBoundingClientRect().width/680;node.scrollLeft=stage.offsetLeft+80*scale-node.clientWidth/2;node.scrollTop=stage.offsetTop+8550*scale-node.clientHeight/2;});await page.waitForTimeout(80);}
    const letter=page.locator('.text-selection-unit').filter({hasText:long?/^K$/:/^O$/}).first();await expect(letter).toBeVisible();await letter.click();
    const beforeView=await page.locator('.text-image-stage').evaluate(node=>({width:node.style.width,height:node.style.height}));
    await page.locator('[data-text-action=recognize]').click();await expect.poll(()=>app.evaluate(()=>global.regionResults.length),{timeout:60000}).toBe(1);
    await expect(page.locator('#run')).toBeEnabled();const first=await app.evaluate(()=>global.regionResults[0]);unaffected(baseline,first.result,first.selection);
    assert.equal(first.result.document.revision,baseline.document.revision+1);assert.match(first.result.text,/ONE OCR 2026/);assert.match(first.result.text,/KEEP THIS LINE/);
    assert.deepEqual(await page.locator('.text-image-stage').evaluate(node=>({width:node.style.width,height:node.style.height})),beforeView);
    assert.equal((await page.evaluate(()=>window.one.recognition.state())).image,original.image);
    await assert.rejects(page.evaluate(async({token,selection})=>window.one.recognition.region(token,'eng',selection),{token:original.token,selection:first.selection}),/已改变/);
    if(long){assert.deepEqual(errors,[]);assert.ok(first.result.document.revisions[0].region.top>8000);console.log('Long image regional OCR: bottom crop, source coordinates, unselected tokens, stale revision and view preserved');return;}
    await page.locator('[data-text-action=rotate]').click();await page.locator('.text-selection-unit').filter({hasText:/^O$/}).first().click();await page.locator('[data-text-action=recognize]').click();
    await expect.poll(()=>app.evaluate(()=>global.regionResults.length),{timeout:60000}).toBe(2);const rotated=await app.evaluate(()=>global.regionResults[1]);unaffected(first.result,rotated.result,rotated.selection);
    await page.locator('#local-model-configure').click();const dialog=page.locator('#local-model-settings');await dialog.locator('[data-select-model=pp-ocrv6-tiny]').click();await choose(page,'local-model-device',gpu===undefined?'CPU':'GPU · DirectML');if(gpu!==undefined){await expect(page.locator('#local-model-gpu-info')).toContainText('GiB',{timeout:15000});await page.locator('#local-model-gpu').click();await page.getByRole('option',{name:new RegExp(' · '+gpu+'$')}).click();}await dialog.locator('#local-model-save').click();
    await page.locator('.text-selection-unit').filter({hasText:/^O$/}).first().click();await page.locator('[data-text-action=recognize]').click();
    await expect.poll(()=>app.evaluate(()=>global.regionResults.length),{timeout:60000}).toBe(3);const paddle=await app.evaluate(()=>global.regionResults[2]);unaffected(rotated.result,paddle.result,paddle.selection);
    assert.match(paddle.result.document.revisions.at(-1).engine.id,/paddle/);assert.equal(paddle.result.inference.backend,gpu===undefined?'cpu':'dml');if(gpu!==undefined)assert.match(paddle.result.inference.device,gpu===0?/NVIDIA/:/AMD/);assert.match(paddle.result.text,/KEEP THIS LINE/);assert.equal(paddle.result.document.engine.id,baseline.document.engine.id);
    await page.locator('.text-selection-unit[data-geometry=ctc]').filter({hasText:/^O$/}).first().click();await page.locator('[data-text-action=copy]').click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'O');
    await page.locator('#ocr-divider').focus();for(let step=0;step<20;step++)await page.keyboard.press('ArrowLeft');
    const actionBounds=await page.locator('.text-selection-actions').boundingBox(),lastBounds=await page.locator('.text-selection-actions button').last().boundingBox();assert.ok(lastBounds.x+lastBounds.width<=actionBounds.x+actionBounds.width+1);
    await page.locator('#local-model-configure').click();await dialog.locator('[data-select-model=tesseract]').click();await dialog.locator('#local-model-save').click();
    const count=await app.evaluate(()=>global.regionWorkers.length);await page.locator('.text-selection-unit').filter({hasText:/^O$/}).first().click();await page.locator('[data-text-action=recognize]').click();
    await expect.poll(()=>app.evaluate((_electron,count)=>global.regionWorkers.length>count&&global.regionWorkers.at(-1).active,count)).toBe(true);await page.locator('#overlay-cancel').click();await expect(page.locator('#run')).toBeEnabled();
    assert.equal(await app.evaluate(()=>global.regionWorkers.at(-1).active),false);assert.equal(await page.locator('#result').inputValue(),paddle.result.text);
    await page.locator('.text-selection-unit').filter({hasText:/^O$/}).first().click();await page.locator('[data-text-action=recognize]').click();await expect.poll(()=>app.evaluate(()=>global.regionResults.length),{timeout:60000}).toBe(4);
    const retry=await app.evaluate(()=>global.regionResults[3]);unaffected(paddle.result,retry.result,retry.selection);assert.equal(retry.result.document.revision,baseline.document.revision+4);
    if(process.argv.includes('--correction-paddle')){await page.locator('#local-model-configure').click();await dialog.locator('[data-select-model=pp-ocrv6-tiny]').click();await choose(page,'local-model-device','CPU');await dialog.locator('#local-model-save').click();}
    await page.locator('#run').click();await expect(page.locator('#run')).toBeEnabled({timeout:60000});const fullAgain=await app.evaluate(()=>global.baseResult);
    assert.ok(fullAgain.document.revision>retry.result.document.revision);await assert.rejects(page.evaluate(async({token,selection})=>window.one.recognition.region(token,'eng',selection),{token:original.token,selection:{...retry.selection,revision:retry.result.document.revision}}),/已改变/);
    await require('./recognition-word-correction.cjs')({app,page,baseline:fullAgain,id:original.token});
    await fs.writeFile(path.join(root,'region-window-'+(gpu===undefined?'cpu':'dml'+gpu)+'.json'),JSON.stringify({inference:paddle.result.inference,region:paddle.result.document.revisions.at(-1),revision:retry.result.document.revision},null,2));
    assert.deepEqual(errors,[]);console.log('Regional OCR window: Tesseract/Paddle selected backend, revision provenance, source/untouched tokens, rotation, copy, stale rejection and real-worker cancel/retry passed');
  }finally{await app?.close().catch(()=>{});const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('region-window-'));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
