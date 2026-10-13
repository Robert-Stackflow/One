const {_electron:electron,expect}=require('@playwright/test'),{build}=require('esbuild'),sharp=require('sharp');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
(async()=>{
  const root=path.resolve('work/current/capture-reconstruction'),fixtures=path.join(root,'deepseek'),directory=await fs.mkdtemp(path.join(root,'native-ui-'));
  const profile=path.join(directory,'profile'),input=path.join(fixtures,'english.png'),errors=[],timings=[];let app,imported=false;
  async function ownedProcesses(){
    const token=path.basename(directory);assert.match(token,/^[a-zA-Z0-9-]+$/);
    const command=`@(Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe' OR Name = 'One.Monitor.exe'" | Where-Object {$_.CommandLine -like '*${token}*'}).Count`;
    const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:4096});return Number(result.stdout.trim());
  }
  async function launch(){
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_INFERENCE_MONITOR:path.resolve('dist/native/One.Monitor.exe')};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one);
    await app.evaluate(({dialog,shell},source)=>{global.__nativeOpened=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});shell.openExternal=async url=>{global.__nativeOpened.push(url);};},input);
    await home.locator('[data-page=materials]').click();
    if(!imported){await home.getByRole('button',{name:'导入图片',exact:true}).click();imported=true;}
    await expect(home.locator('#material-results .asset-card')).toHaveCount(1);
    return openOCR(home);
  }
  async function openOCR(home){
    const opening=app.waitForEvent('window',{predicate:async page=>{try{await page.waitForURL('**view=recognition',{timeout:5000});return true;}catch{return false;}}});void opening.catch(()=>{});
    await home.getByRole('button',{name:'识别文字',exact:true}).click();const page=await opening;page.on('pageerror',error=>errors.push(String(error)));
    await expect(page.locator('#run')).toBeEnabled();return page;
  }
  async function openModels(page){
    const timing=await page.evaluate(()=>{
      const start=performance.now();document.querySelector('#local-model-configure').click();
      return {shellMs:Math.round(performance.now()-start),open:document.querySelector('#local-model-settings').open};
    });assert.equal(timing.open,true);
    const started=performance.now(),dialog=page.locator('#local-model-settings');await expect(dialog.locator('[data-select-model=deepseek-ocr-v2]')).toBeAttached();
    const state=await page.evaluate(()=>window.one.recognition.localModels());timings.push({...timing,contentMs:Math.round(performance.now()-started)});
    assert.equal(state.entries.filter(entry=>entry.id.startsWith('deepseek-ocr-')).length,2);assert.ok(state.entries.every(entry=>entry.purpose==='ocr'));
    return dialog;
  }
  async function choose(page,id,label){await page.locator('#'+id).click();await page.getByRole('option',{name:label,exact:true}).click();}
  async function apply(page,id,label){
    const dialog=await openModels(page);await dialog.locator(`[data-select-model=${id}]`).click();await choose(page,'local-model-device',label);
    await expect(dialog.locator('#local-model-save')).toHaveText('使用此模型');await dialog.locator('#local-model-save').click();await expect(dialog).not.toBeVisible();
    const state=await page.evaluate(()=>window.one.recognition.localModels());assert.equal(state.choices.ocr.modelId,id);return state;
  }
  async function recognize(page,model,backend){
    await page.locator('#result').fill('');await page.locator('#run').click();await expect(page.locator('#result')).toHaveValue(/ONE\s*OCR\s*2026/,{timeout:180000});
    const result=await page.evaluate(async()=>{const api=window.one.recognition,state=await api.state();return api.run(state.token,'chi_sim+eng');});
    assert.equal(result.inference.backend,backend);assert.match(result.document.engine.model,new RegExp(model));
    assert.deepEqual(result.words,[]);assert.deepEqual(result.document.blocks,[]);return result;
  }
  try{
    const prepare=path.join(directory,'prepare.cjs');await build({entryPoints:['tests/recognition/native-ocr-ui-prepare.ts'],outfile:prepare,bundle:true,platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    await run(process.execPath,[prepare],{env:{...process.env,ONE_MODEL_UI_PROFILE:profile},windowsHide:true,maxBuffer:65536,timeout:180000});
    let page=await launch();
    if(process.argv.includes('--cancel')){
      await apply(page,'deepseek-ocr-v1','CPU');const before=await page.evaluate(()=>window.one.recognition.state());
      await page.locator('#run').click();await expect.poll(ownedProcesses,{timeout:30000}).toBeGreaterThanOrEqual(2);
      await page.locator('#overlay-cancel').click();await expect(page.locator('#run')).toBeEnabled({timeout:15000});
      assert.equal(await ownedProcesses(),0);const after=await page.evaluate(()=>window.one.recognition.state());
      assert.equal(after.token,before.token);assert.equal(after.image,before.image);assert.equal(after.models.ready,true);
      await apply(page,'deepseek-ocr-v2','GPU · CUDA');await recognize(page,'d08e5af4','cuda');
      await apply(page,'deepseek-ocr-v1','CPU');await page.locator('#run').click();await expect.poll(ownedProcesses,{timeout:30000}).toBeGreaterThanOrEqual(2);
      await page.close();await expect.poll(ownedProcesses,{timeout:15000}).toBe(0);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(fixtures,'native-ui-cancel-results.json'),JSON.stringify({overlayCancel:true,imagePreserved:true,retryCUDA:true,closeActiveWindow:true},null,2));
      console.log('native OCR UI: overlay cancellation preserves the image, CUDA retry succeeds, and closing an active native window drains its processes');return;
    }
    await apply(page,'deepseek-ocr-v1','CPU');await recognize(page,'7086620c','cpu');
    await apply(page,'deepseek-ocr-v2','GPU · CUDA');await recognize(page,'d08e5af4','cuda');
    assert.ok(await ownedProcesses()>=2);
    let dialog=await openModels(page);await expect(dialog.locator('[data-select-model=deepseek-ocr-v2] .model-current')).toBeVisible();
    await expect(dialog.locator('#local-model-delete')).toBeEnabled();await expect(dialog.locator('#local-model-gpu-info')).toHaveText(/CUDA \d+/);
    const layout=await dialog.evaluate(node=>{
      const list=node.querySelector('.model-list'),detail=node.querySelector('.model-detail'),heading=node.querySelector('.model-detail-heading');
      const before=detail.scrollTop;list.scrollTop=list.scrollHeight;const box=heading.getBoundingClientRect(),bounds=node.getBoundingClientRect();
      return {independent:detail.scrollTop===before,listOverflow:list.scrollHeight>list.clientHeight,headerInside:box.top>=bounds.top&&box.bottom<=bounds.bottom};
    });assert.ok(layout.independent&&layout.listOverflow&&layout.headerInside);
    await dialog.locator('#local-model-metadata a').first().click();await expect.poll(()=>app.evaluate(()=>global.__nativeOpened.length)).toBe(1);
    await page.evaluate(()=>window.open('https://example.invalid/blocked-model-link','_blank'));
    assert.equal((await app.evaluate(()=>global.__nativeOpened)).length,1);
    const screenshot=await page.screenshot();await sharp(screenshot).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(fixtures,'native-model-dialog.png'));
    await dialog.locator('[data-dialog-dismiss]').click();await expect(dialog).not.toBeVisible();
    await app.close();app=undefined;assert.equal(await ownedProcesses(),0);
    page=await launch();assert.equal((await page.evaluate(()=>window.one.recognition.localModels())).choices.ocr.modelId,'deepseek-ocr-v2');
    await recognize(page,'d08e5af4','cuda');dialog=await openModels(page);await dialog.locator('#local-model-delete').click();
    await expect(dialog.locator('#local-model-status')).toHaveText('未安装');assert.equal(await ownedProcesses(),0);
    const models=await page.evaluate(()=>window.one.recognition.localModels());assert.equal(models.entries.find(entry=>entry.id==='deepseek-ocr-v2').ready,false);
    await dialog.locator('[data-select-model=tesseract]').click();await dialog.locator('#local-model-save').click();await expect(dialog).not.toBeVisible();
    await page.close();assert.equal(await ownedProcesses(),0);assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(fixtures,'native-ui-results.json'),JSON.stringify({timings,models:['v1 CPU','v2 CUDA'],persisted:true,idleDelete:true,sourceLinks:true,shutdown:true},null,2));
    await fs.rm(path.join(fixtures,'native-ui-error.log'),{force:true});
    console.log('native OCR UI: fast shell, two presets, CPU/CUDA apply-close and inference, source links, independent columns, restart persistence, idle delete and shutdown passed');
  }catch(error){await fs.writeFile(path.join(fixtures,'native-ui-error.log'),error.stack||String(error));console.error('Native OCR UI failed; see work/current/capture-reconstruction/deepseek/native-ui-error.log');process.exitCode=1;}
  finally{await app?.close().catch(()=>{});const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error));process.exitCode=1});
