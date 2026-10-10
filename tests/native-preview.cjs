const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process'),esbuild=require('esbuild'),{_electron:electron,expect}=require('@playwright/test');
(async()=>{
 const dir=path.resolve('work/current/native-preview/tests');await fs.mkdir(dir,{recursive:true});
 execFileSync(process.execPath,['scripts/build-preview.mjs'],{env:{...process.env,ONE_PREVIEW_BUILD_TEST:'1'},windowsHide:true,stdio:'pipe'});
 const helper=path.resolve('work/current/native-preview/build/One.Preview.Test.exe'),helper32=path.resolve('work/current/native-preview/build/One.Preview.Test32.exe'),module=path.join(dir,'native-preview.cjs');await esbuild.build({entryPoints:['src/main/native-preview.ts'],outfile:module,bundle:true,platform:'node',format:'cjs'});
 const files={};for(const mode of ['ready','hang','error','crash']){files[mode]=path.join(dir,mode+'.xlsx');await fs.writeFile(files[mode],mode);}
 const unsupported=path.join(dir,'native.one-preview-test-unsupported');await fs.writeFile(unsupported,'ready');
 const profile=await fs.mkdtemp(path.join(dir,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_TEST_NATIVE_PREVIEW_HOST:helper};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});let count=0;
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=text]');await app.evaluate(({app})=>app.on('browser-window-created',(_e,w)=>setImmediate(()=>w.removeAllListeners('blur'))));
  const result=await app.evaluate(async({BrowserWindow,app},input)=>{
   const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const {NativePreviewService}=require(input.module),window=BrowserWindow.getAllWindows()[0],bounds={x:10,y:40,width:400,height:220},events=[];
   const service=new NativePreviewService(()=>[input.helper],250),notify=s=>events.push(s),start=(token,file)=>service.start(900,token,window,file,bounds,notify,()=>{});
   const ready=await start('ready',input.files.ready);service.stop(900,'stale');service.resize(900,'ready',{...bounds,width:500},window);const same=await start('ready',input.files.ready);
   const hang=start('cancel',input.files.hang);service.stop(900,'cancel');const cancelled=await hang;
   const timeout=await start('timeout',input.files.hang),error=await start('error',input.files.error),crash=await start('crash',input.files.crash);await new Promise(r=>setTimeout(r,400));
   const replacing=start('old',input.files.hang),next=await start('new',input.files.ready),old=await replacing;service.stopAll();await new Promise(r=>setTimeout(r,1000));
   const missingService=new NativePreviewService(()=>[input.production64,input.production32],1000),missing=await missingService.start(901,'missing',window,input.unsupported,bounds,()=>{},()=>{});missingService.stopAll();
   const fallbackService=new NativePreviewService(()=>[input.production64,input.helper32],1000),fallback=await fallbackService.start(902,'fallback',window,input.unsupported,bounds,()=>{},()=>{});fallbackService.stopAll();
   return {ready,same,cancelled,timeout,error,crash,next,old,events,missing,fallback};
  },{module,helper,helper32,files,unsupported,production64:path.resolve('dist/native/One.Preview.exe'),production32:path.resolve('dist/native/One.Preview32.exe')});
  for(const k of ['ready','same','crash','next','fallback']){assert.equal(result[k].status,'ready',k);count++;}
  for(const k of ['cancelled','timeout','error','old','missing']){assert.equal(result[k].status,'error',k);count++;}
  assert.match(result.timeout.message,/超时/);assert.match(result.old.message,/取消/);assert.ok(result.events.some(e=>e.token==='crash'&&/退出/.test(e.message||'')));assert.ok(!result.events.some(e=>e.token==='cancel'||e.token==='old'));count+=4;
  const opening=app.waitForEvent('window');await main.evaluate(f=>window.one.preview(f),files.ready);const preview=await opening;await expect(preview.locator('#preview-status-kind')).toHaveText('工作簿');await expect(preview.locator('.native-office-preview')).toHaveAttribute('aria-label','原生工作簿预览');assert.equal(await preview.locator('.sheet-table').count(),0);count+=3;
  const browserWindow=await app.browserWindow(preview),windowId=await browserWindow.evaluate(w=>w.id);
  const nativeRect=()=>app.evaluate(({BrowserWindow,app},id)=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),koffi=require('koffi'),u=koffi.load('user32.dll'),find=u.func('uintptr_t __stdcall FindWindowExW(uintptr_t, uintptr_t, str16, str16)'),Rect=koffi.struct({left:'long',top:'long',right:'long',bottom:'long'}),get=u.func('GetClientRect','bool',['uintptr_t',koffi.out(koffi.pointer(Rect))]),dpi=u.func('uint32_t __stdcall GetDpiForWindow(uintptr_t)'),w=BrowserWindow.fromId(id),parent=Number(w.getNativeWindowHandle().readBigUInt64LE()),child=find(parent,0,'One.NativePreviewHost',null),rect={};if(!child)return {width:-1,height:-1,dpi:dpi(parent)};get(child,rect);return {width:rect.right,height:rect.bottom,dpi:dpi(parent)};},windowId);
  const css=await preview.locator('.native-office-preview').boundingBox(),actual=await nativeRect();assert.ok(Math.abs(actual.width-css.width*actual.dpi/96)<3);assert.ok(Math.abs(actual.height-css.height*actual.dpi/96)<3);count+=2;
  await preview.locator('#preview-more').click();await expect.poll(async()=>(await nativeRect()).width).toBe(0);await preview.locator('#preview-more').click();await expect.poll(async()=>(await nativeRect()).width).toBeGreaterThan(300);count+=2;
  await preview.reload();await expect(preview.locator('.native-office-preview')).toHaveAttribute('aria-label','原生工作簿预览');count++;
  const state=await preview.evaluate(()=>window.one.previewData());assert.equal(state.type,'native-office');assert.ok(state.nativeOfficeToken);assert.equal(state.workbook,undefined);count+=3;
  await assert.rejects(()=>main.evaluate(t=>window.one.nativePreviewStart(t,{x:0,y:0,width:100,height:100}),state.nativeOfficeToken));
  await assert.rejects(()=>preview.evaluate(()=>window.one.nativePreviewStart('stale',{x:0,y:0,width:100,height:100})));
  await assert.rejects(()=>preview.evaluate(t=>window.one.nativePreviewStart(t,{x:-1,y:0,width:100,height:100}),state.nativeOfficeToken));count+=3;
  await preview.evaluate(t=>window.one.nativePreviewStop(t),state.nativeOfficeToken);await preview.evaluate(t=>window.one.nativePreviewStart(t,{x:20,y:100,width:400,height:250}),state.nativeOfficeToken);count++;
  await preview.evaluate(f=>window.one.selectPreview(f),files.error);await expect(preview.locator('#native-preview-retry')).toBeVisible();await expect(preview.locator('#native-preview-open')).toBeVisible();await preview.locator('#native-preview-retry').click();await expect(preview.locator('.preview-error-detail')).toContainText('加载失败');count+=3;
  await preview.evaluate(f=>window.one.selectPreview(f),files.ready);await expect(preview.locator('.native-office-preview')).toHaveAttribute('aria-label','原生工作簿预览');await preview.close();await new Promise(r=>setTimeout(r,1000));
  for(const file of Object.values(files)){const moved=file+'.moved';await fs.rename(file,moved);await fs.rename(moved,file);count++;}
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks:count,service:result,scope:'Test provider checks hosting/lifecycle; production provider availability only, not Excel/WPS fidelity'},null,2));console.log(`Native preview: ${count} checks passed; test provider, plus production missing-component path.`);
 }finally{await app.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
