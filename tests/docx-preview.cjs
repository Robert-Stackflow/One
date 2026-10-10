const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {build}=require('esbuild'),{_electron:electron,expect}=require('@playwright/test');

(async()=>{
 const repository=path.resolve('.'),source=process.env.ONE_DOCX_SOURCE_ROOT?path.resolve(process.env.ONE_DOCX_SOURCE_ROOT):repository;
 const root=path.join(repository,'work/current/office-preview/docx-integration'),main=path.join(root,'main'),renderer=path.join(root,'renderer'),files=path.join(root,'fixtures');
 await fs.mkdir(root,{recursive:true});await require('./docx-preview-fixtures.cjs')(files);
 const original=await fs.readFile(path.join(files,'daily.docx')),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 if(process.env.ONE_DOCX_REUSE!=='1'){
  const {mainOptions,preloadOptions}=await import('../scripts/bundle-options.mjs');
  await build({...mainOptions,entryPoints:mainOptions.entryPoints.map(f=>path.join(source,f)),outdir:main,logLevel:'silent'});
  await build({...preloadOptions,entryPoints:preloadOptions.entryPoints.map(f=>path.join(source,f)),outfile:path.join(root,'preload/index.cjs'),logLevel:'silent'});
  const vite=await import('vite');await vite.build({root:path.join(source,'src/renderer'),base:'./',build:{outDir:renderer,emptyOutDir:true,minify:false},logLevel:'silent'});
  for(const name of ['native','icons'])await fs.cp(path.join(repository,'dist',name),path.join(root,name),{recursive:true});
  await fs.cp(path.join(repository,'assets/file-icons'),path.join(renderer,'file-icons'),{recursive:true});
  for(const name of ['system-info','proxy-info','maintenance-actions','maintenance','brightness'])await fs.copyFile(path.join(source,'src/main',name+'.ps1'),path.join(main,name+'.ps1'));
 }
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'one-docx-window-test',version:'0.16.20',main:'entry.cjs'}));
 await fs.writeFile(path.join(root,'entry.cjs'),`const{app,BrowserWindow}=require('electron');for(const key of ['show','showInactive','focus','moveTop'])BrowserWindow.prototype[key]=function(){};app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);setImmediate(()=>w.removeAllListeners('blur'));});require('./main/index.cjs');`);
 const profile=await fs.mkdtemp(path.join(root,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;delete env.ONE_TEST_NATIVE_PREVIEW_HOST;
 const app=await electron.launch({args:['--force-device-scale-factor=1.25','--disable-renderer-backgrounding',root],env});
 const result={source,checks:[],errors:[],external:[]};
 try{
  const home=await app.firstWindow();await home.waitForSelector('[data-page=text]',{timeout:30000});const opening=app.waitForEvent('window');await home.evaluate(file=>window.one.preview(file),path.join(files,'daily.docx'));const preview=await opening;
  preview.on('pageerror',e=>result.errors.push(e.message.slice(0,500)));preview.on('request',r=>{if(/^https?:/.test(r.url()))result.external.push(r.url());});
  await preview.addInitScript(()=>{window.docxWorkers={created:0,terminated:0};const W=Worker;window.Worker=new Proxy(W,{construct(T,args){const worker=Reflect.construct(T,args);window.docxWorkers.created++;const terminate=worker.terminate.bind(worker);worker.terminate=()=>{window.docxWorkers.terminated++;return terminate();};return worker;}});});
  await preview.reload();await expect(preview.locator('.docx-preview')).toHaveAttribute('data-state','ready',{timeout:30000});
  result.data=await preview.evaluate(()=>window.one.previewData());assert.equal(result.data.type,'docx');assert.equal(result.data.nativeOfficeToken,undefined);delete result.data;
  const content=preview.locator('.docx-preview-surface');await expect(content).toContainText('PARAGRAPH_2');result.resolution=await content.locator('canvas').evaluateAll(items=>items.map(c=>({width:c.width,height:c.height,cssWidth:c.getBoundingClientRect().width,cssHeight:c.getBoundingClientRect().height,dpr:devicePixelRatio})));assert.ok(result.resolution.every(c=>c.width/c.cssWidth>=1.99));result.pages=await content.locator('canvas').count();assert.ok(result.pages>0);result.checks.push('actual DOCX route, worker-rendered content and page canvases');if(process.env.ONE_DOCX_CAPTURE_LABEL){const r=await content.boundingBox();await preview.screenshot({path:path.join(root,'text-'+process.env.ONE_DOCX_CAPTURE_LABEL+'.png'),clip:{x:r.x+80,y:r.y+130,width:650,height:240}});}
  await preview.locator('#preview-minimize').hover();const tooltip=preview.locator('#one-tooltip.visible');await expect(tooltip).toBeVisible();assert.ok(await tooltip.evaluate(el=>{const r=el.getBoundingClientRect(),previous=el.style.pointerEvents;el.style.pointerEvents='auto';const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);el.style.pointerEvents=previous;return !!top?.closest('#one-tooltip');}));await preview.mouse.move(400,200);result.checks.push('header tooltip remains above worker-rendered pages');
  if(await preview.locator('#preview-files').getAttribute('aria-pressed')!=='true')await preview.locator('#preview-files').click();await preview.locator('#side-outline').click();await expect(preview.locator('.preview-outline-item')).toHaveCount(3);
  await content.evaluate(el=>{let clicked=0;document.addEventListener('click',event=>{if(event.target.closest('.preview-outline-item')?.textContent.includes('章节_120_中文'))clicked=performance.now();},{capture:true});const observer=new MutationObserver(()=>{if(clicked&&el.textContent.includes('章节_120_中文')){window.docxJumpRenderMs=performance.now()-clicked;observer.disconnect();}});observer.observe(el,{childList:true,subtree:true,characterData:true});});
  const start=Date.now();await preview.locator('.preview-outline-item').filter({hasText:'章节_120_中文'}).click();await expect(content).toContainText('章节_120_中文');result.jumpMs=Date.now()-start;result.jumpRenderMs=await preview.evaluate(()=>window.docxJumpRenderMs);
  result.scroll=await content.evaluate(el=>Array.from(el.querySelectorAll('*')).filter(e=>e.scrollHeight>e.clientHeight+10&&e.clientHeight>0).map(e=>e.scrollTop));assert.ok(result.scroll.some(n=>n>100));result.checks.push('inherited heading styles and direct last-heading page jump');
  const dimensions=await preview.evaluate(()=>({width:innerWidth,height:innerHeight})),cdp=await preview.context().newCDPSession(preview);
  await cdp.send('Emulation.setDeviceMetricsOverride',{...dimensions,deviceScaleFactor:2.5,mobile:false});
  await expect.poll(()=>content.locator('canvas').evaluateAll(items=>items.length>0&&items.filter(c=>c.getBoundingClientRect().width>0).every(c=>c.width/c.getBoundingClientRect().width>=2.49))).toBe(true);
  await expect(content).toContainText('章节_120_中文');result.checks.push('DPI change redraws high-density canvases and preserves directory page');
  await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.detach();
  await preview.locator('#side-overview').click();const thumbnails=preview.locator('.preview-overview-card canvas');await expect(thumbnails.first()).toBeVisible({timeout:20000});
  result.thumbnail=await thumbnails.first().evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&pixels[i]<220&&pixels[i+1]<220&&pixels[i+2]<220)ink++;return {width:canvas.width,height:canvas.height,ink};});assert.ok(result.thumbnail.ink>100,'overview thumbnail contains actual text pixels');
  await preview.locator('.preview-overview-card').first().click();await expect(content).toContainText('PARAGRAPH_2');result.checks.push('actual overview tab has nonblank thumbnail pixels and clicks navigate');
  await preview.locator('#side-outline').click();
  await preview.locator('.preview-outline-item').filter({hasText:'章节_1_中文'}).click();await expect(content).toContainText('PARAGRAPH_2');
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'malformed.docx'));await expect(preview.locator('.docx-preview')).toHaveAttribute('data-state','error',{timeout:20000});await expect(preview.locator('.docx-preview')).toContainText('文档无法读取');result.checks.push('malformed XML reports failure instead of a successful diagnostic page');
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'daily.docx'));await expect(preview.locator('.docx-preview')).toHaveAttribute('data-state','ready',{timeout:30000});
  await preview.evaluate(()=>{const previous=window.docxWorkers.created;window.docxCancelled=false;const timer=setInterval(()=>{const button=Array.from(document.querySelectorAll('.docx-preview[data-state="loading"] button')).find(b=>b.textContent==='取消加载');if(window.docxWorkers.created>previous&&button){clearInterval(timer);button.click();window.docxCancelled=true;}},10);setTimeout(()=>clearInterval(timer),20000);});
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'malformed.docx'));await preview.waitForFunction(()=>window.docxCancelled);await expect(preview.locator('.docx-preview')).toHaveAttribute('data-state','cancelled');result.checks.push('cancel during background outline preparation');
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'daily.docx'));await expect(preview.locator('.docx-preview')).toHaveAttribute('data-state','ready',{timeout:30000});
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'plain.txt'));await expect(preview.locator('.cm-content')).toContainText('PLAIN_DOCX_EXIT');await expect(preview.locator('.docx-preview')).toHaveCount(0);await preview.waitForFunction(()=>window.docxWorkers.created===window.docxWorkers.terminated,undefined,{timeout:25000});result.workers=await preview.evaluate(()=>window.docxWorkers);result.checks.push('recovery, file replacement and all worker release');
  assert.equal(hash(await fs.readFile(path.join(files,'daily.docx'))),hash(original));assert.deepEqual(result.errors,[]);assert.deepEqual(result.external,[]);result.checks.push('source hash unchanged and no external requests');result.passed=true;
 }catch(error){result.failure=error.stack?.slice(0,1800)||String(error);throw error;}
 finally{await fs.writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2));await app.close();}
 console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
