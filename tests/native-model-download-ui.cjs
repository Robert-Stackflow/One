const {build}=require('esbuild'),{_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'native-download-'));let app;
  try{
    await build({stdin:{contents:`
      import {mountLocalModels} from './src/renderer/recognition/local-models-ui';
      const gpu={id:'00000000:00000003',deviceId:19,name:'NVIDIA fixture',vendorId:0x10de,pciDeviceId:1,dedicatedMemory:8*1024**3,sharedMemory:0,d3d12:true,cudaDeviceId:3,cudaDriverVersion:12040};
      const entry={id:'deepseek-ocr-v2',title:'DeepSeek OCR',size:'v2 · 3B',purpose:'ocr',revision:'fixture',backends:['cpu','cuda'],ready:true,downloading:false,inUse:false,totalBytes:3.4*1024**3,diskBytes:3.4*1024**3,downloadedBytes:3.4*1024**3,progress:0,error:'',weightLicense:'MIT',precision:'q8_0',runtimeReady:{cpu:true,cuda:false}};
      const state={revision:'fixture',choices:{ocr:{modelId:entry.id,device:{mode:'cpu'}}},entries:[entry],devices:{gpus:[gpu,{...gpu,id:'00000000:00000004',vendorId:0x1002,name:'AMD fixture',cudaDeviceId:undefined,cudaDriverVersion:undefined}]}};
      let pending,releaseUpdated;window.fixture={saved:0,cancelled:0,preferences:[],complete(){entry.downloading=false;entry.runtimeReady.cuda=true;entry.progress=1;pending.resolve();},updated(){releaseUpdated();}};
      const api={localModels:async()=>structuredClone(state),installLocalModel:async(id,preference)=>{
        window.fixture.preferences.push(preference);if(entry.runtimeReady.cuda)return;
        entry.downloading=true;entry.progress=.9;return new Promise((resolve,reject)=>pending={resolve,reject});
      },cancelLocalModelInstall:async()=>{window.fixture.cancelled++;entry.downloading=false;pending.reject(Error('已取消'));},
      saveLocalModel:async(purpose,choice)=>{window.fixture.saved++;window.fixture.savedChoice=choice;state.choices.ocr=choice;return 'next';},deleteLocalModel:async()=>{},refreshInferenceDevices:async()=>state.devices};
      const open=mountLocalModels(api,()=>new Promise(resolve=>releaseUpdated=resolve));window.fixture.open=open;void open();
    `,resolveDir:path.resolve('.'),sourcefile:'native-download-fixture.ts',loader:'ts'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',target:'chrome120',logLevel:'warning'});
    await fs.writeFile(path.join(directory,'index.html'),'<html style="--surface:#fff;--fg:#222;--muted:#777;--line:#e7e7e7;--soft:#f5f5f5;--accent:#333;--on-accent:white"><head><link rel="stylesheet" href="fixture.css"></head><body><div id="app"></div><script>window.one={};</script><script src="fixture.js"></script></body></html>');
    await fs.writeFile(path.join(directory,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:1100,height:850}).loadFile(${JSON.stringify(path.join(directory,'index.html'))}));`);
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[path.join(directory,'main.cjs')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    const dialog=page.locator('#local-model-settings'),action=dialog.locator('#local-model-save');await expect(dialog).toBeVisible();await expect(action).toHaveText('使用此模型');
    await page.locator('#local-model-device').click();await page.getByRole('option',{name:'GPU · CUDA',exact:true}).click();
    await expect(action).toHaveText('继续下载并使用');await expect(dialog.locator('#local-model-gpu-info')).toHaveText(/CUDA 3/);
    await page.locator('#local-model-gpu').click();await expect(page.getByRole('option',{name:/AMD/})).toHaveCount(0);
    await expect(page.getByRole('option',{name:'NVIDIA fixture · CUDA 3',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await action.click();await expect(action).toHaveText('取消下载 · 90%');await expect(dialog.locator('.one-dialog-actions button')).toHaveCount(1);await action.click();
    await expect(action).toHaveText('继续下载并使用');await expect(dialog.locator('#local-model-error')).toBeHidden();assert.equal(await page.evaluate(()=>fixture.cancelled),1);
    await action.click();await expect(action).toHaveText('取消下载 · 90%');
    await page.locator('#local-model-device').click();await page.getByRole('option',{name:'CPU',exact:true}).click();
    await page.evaluate(()=>fixture.complete());await expect(dialog).not.toBeVisible();
    assert.equal(await page.evaluate(()=>fixture.saved),1);assert.equal(await page.evaluate(()=>fixture.preferences.every(preference=>preference.mode==='gpu')),true);
    assert.equal(await page.evaluate(()=>fixture.savedChoice.device.mode),'gpu');
    // Closing must not depend on the caller's potentially slow OCR state refresh.
    await page.evaluate(()=>fixture.updated());await expect(action).toBeEnabled();assert.deepEqual(errors,[]);
    console.log('native download UI: CUDA-only adapters, runtime readiness, one aggregate action, cancellation/resume, frozen device preference and close before refresh passed');
  }finally{await app?.close().catch(()=>{});const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error).slice(0,2000));process.exitCode=1});
