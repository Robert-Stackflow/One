const { _electron: electron, expect } = require('@playwright/test');
const { build } = require('esbuild');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('work/current/capture-reconstruction');
  const directory = await fs.mkdtemp(path.join(root, 'download-ui-')); let app;
  try {
    await build({ stdin: { contents: `
      import { mountLocalModels } from './src/renderer/recognition/local-models-ui';
      const entry={id:'fixture',title:'PP-OCRv6',size:'medium',purpose:'ocr',revision:'fixture',backends:['cpu'],ready:false,downloading:false,inUse:false,totalBytes:100,diskBytes:0,downloadedBytes:0,progress:0,error:'',weightLicense:'Apache-2.0',precision:'fp32'};
      const installed={...entry,id:'installed',title:'Tesseract',ready:true};
      const state={revision:'fixture',choices:{ocr:{modelId:'fixture',device:{mode:'cpu'}}},entries:[entry,installed],devices:{gpus:[],error:''}};
      let pending;
      window.fixture={saved:0,cancelled:0,mode:'pending',complete(){entry.downloading=false;entry.ready=true;entry.progress=1;pending.resolve();}};
      const api={localModels:async()=>structuredClone(state),installLocalModel:async()=>{
        entry.error='';entry.downloading=true;entry.progress=.13;entry.diskBytes=entry.downloadedBytes=13;
        if(window.fixture.mode==='fail'){entry.downloading=false;entry.error='下载失败，请重试';throw Error(entry.error);}
        return new Promise((resolve,reject)=>pending={resolve,reject});
      },cancelLocalModelInstall:async()=>{window.fixture.cancelled++;await new Promise(r=>setTimeout(r,30));entry.downloading=false;pending.reject(Error('已取消'));},saveLocalModel:async()=>{window.fixture.saved++;},deleteLocalModel:async()=>{},refreshInferenceDevices:async()=>state.devices};
      window.openModels=mountLocalModels(api,async()=>{});window.openModels();
    `, resolveDir: process.cwd(), sourcefile: 'download-ui.ts', loader: 'ts' }, outfile: path.join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', logLevel: 'warning' });
    await fs.writeFile(path.join(directory, 'index.html'), '<html style="--surface:white;--fg:#222;--line:#ddd;--soft:#f5f5f5;--accent:#333;--on-accent:white"><head><link rel="stylesheet" href="fixture.css"></head><body><div id="app"></div><script>window.one={};</script><script src="fixture.js"></script></body></html>');
    await fs.writeFile(path.join(directory, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:1100,height:850}).loadFile(${JSON.stringify(path.join(directory,'index.html'))}));`);
    const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.join(directory,'main.cjs')],env}); const page=await app.firstWindow(),errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    const dialog=page.locator('#local-model-settings'),action=dialog.locator('#local-model-save');
    await expect(dialog).toBeVisible(); await expect(dialog.locator('.one-dialog-actions button')).toHaveCount(1);
    await expect(action).toHaveText('下载并使用'); await action.click();
    await expect(action).toHaveText('取消下载 · 13%'); await expect(action).toBeEnabled();
    await dialog.locator('[data-select-model=installed]').click(); await expect(action).toBeDisabled();
    await dialog.locator('[data-select-model=fixture]').click(); await expect(action).toBeEnabled(); await action.click();
    await expect(action).toHaveText('继续下载并使用'); await expect(dialog).toBeVisible(); await expect(dialog.locator('#local-model-error')).toBeHidden();
    assert.deepEqual(await page.evaluate(()=>[fixture.saved,fixture.cancelled]),[0,1]);
    await page.evaluate(()=>fixture.mode='fail'); await action.click(); await expect(dialog.locator('#local-model-error')).toHaveText('下载失败，请重试'); await expect(action).toBeEnabled();
    await page.evaluate(()=>fixture.mode='pending'); await action.click(); await expect(action).toHaveText('取消下载 · 13%'); await page.evaluate(()=>fixture.complete());
    await expect(dialog).not.toBeVisible(); assert.equal(await page.evaluate(()=>fixture.saved),1); assert.deepEqual(errors,[]);
    console.log('download UI: one action, progress, browse, cancellation, resume, error retry and apply-close passed');
  } finally { await app?.close(); const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
