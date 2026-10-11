const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {build:bundle}=require('esbuild'),{_electron:electron,expect}=require('@playwright/test');

(async()=>{
 const repository=path.resolve('.'),root=path.join(repository,'work/current/office-preview/window');
 const source=process.env.ONE_XLSX_SOURCE_ROOT?path.resolve(process.env.ONE_XLSX_SOURCE_ROOT):repository;
 const main=path.join(root,'main'),renderer=path.join(root,'renderer'),files=path.join(root,'fixtures');
 assert.ok(root.startsWith(path.join(repository,'work')+path.sep));
 await fs.mkdir(root,{recursive:true});
 if(process.env.ONE_XLSX_WINDOW_REUSE!=='1'){
  await require('./xlsx-preview-fixtures.cjs')(files);await fs.writeFile(path.join(files,'plain.txt'),'PLAIN_FILE_MARKER');
  const {mainOptions,preloadOptions}=await import('../scripts/bundle-options.mjs');
  await bundle({...mainOptions,entryPoints:mainOptions.entryPoints.map(f=>path.join(source,f)),outdir:main,logLevel:'silent'});
  await bundle({...preloadOptions,entryPoints:preloadOptions.entryPoints.map(f=>path.join(source,f)),outfile:path.join(root,'preload/index.cjs'),logLevel:'silent'});
  const vite=await import('vite');await vite.build({root:path.join(source,'src/renderer'),base:'./',build:{outDir:renderer,emptyOutDir:true,minify:false},logLevel:'silent'});
  for(const name of ['native','icons'])await fs.cp(path.join(repository,'dist',name),path.join(root,name),{recursive:true});
  await fs.cp(path.join(repository,'assets/file-icons'),path.join(renderer,'file-icons'),{recursive:true});
  for(const name of ['system-info','proxy-info','maintenance-actions','maintenance','brightness'])await fs.copyFile(path.join(source,'src/main',name+'.ps1'),path.join(main,name+'.ps1'));
 }
 const assets=await fs.readdir(path.join(renderer,'assets'));let toastModule;
 for(const name of assets.filter(n=>n.endsWith('.js'))){const code=await fs.readFile(path.join(renderer,'assets',name),'utf8');if(!code.includes('function toast('))continue;const match=/\btoast as (\w+)/.exec(code.slice(code.lastIndexOf('export {')));if(match){toastModule={url:'one://app/assets/'+name,key:match[1]};break;}}
 assert.ok(toastModule,'Locate actual shared toast export in the unminified application build');
 const profile=await fs.mkdtemp(path.join(root,'profile-'));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'one-xlsx-window-test',version:'0.16.20',main:'entry.cjs'}));
 // Keep this test's real application windows hidden without changing product code.
 await fs.writeFile(path.join(root,'entry.cjs'),`const{app,BrowserWindow}=require('electron');for(const key of ['show','showInactive','focus','moveTop'])BrowserWindow.prototype[key]=function(){};app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);setImmediate(()=>w.removeAllListeners('blur'));});require('./main/index.cjs');`);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;delete env.ONE_TEST_NATIVE_PREVIEW_HOST;
 const scale=process.env.ONE_XLSX_WINDOW_SCALE||'1.25';
 const app=await electron.launch({args:['--force-device-scale-factor='+scale,'--disable-renderer-backgrounding',root],env});
 const result={source,scale,errors:[],external:[],checks:[]};let preview;
 try{
  const home=await app.firstWindow();await home.waitForSelector('[data-page=text]',{timeout:30000});
  const opening=app.waitForEvent('window');await home.evaluate(file=>window.one.preview(file),path.join(files,'daily.xlsx'));preview=await opening;
  preview.on('pageerror',e=>result.errors.push(e.message));preview.on('request',r=>{if(/^https?:/.test(r.url()))result.external.push(r.url());});
  await preview.addInitScript(()=>{window.xlsxCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.xlsxCopies.push(text)}});window.xlsxWorkers={created:0,terminated:0};const W=Worker;window.Worker=new Proxy(W,{construct(T,args){const w=Reflect.construct(T,args);window.xlsxWorkers.created++;const terminate=w.terminate.bind(w);w.terminate=()=>{window.xlsxWorkers.terminated++;return terminate();};return w;}});});
  await preview.reload();await expect(preview.locator('.xlsx-preview')).toHaveAttribute('data-state','ready',{timeout:20000});const gridBox=await preview.getByRole('region',{name:/Spreadsheet viewport/}).boundingBox();await preview.mouse.click(gridBox.x+400,gridBox.y+55);await preview.keyboard.press('Control+c');await expect.poll(()=>preview.evaluate(()=>window.xlsxCopies.at(-1))).toBe('$1,235.50');
  const data=await preview.evaluate(()=>window.one.previewData());assert.equal(data.type,'xlsx');assert.equal(data.nativeOfficeToken,undefined);result.dpr=await preview.evaluate(()=>devicePixelRatio);assert.equal(result.dpr,Number(scale));result.checks.push('real application XLSX route and formatted cell copy');
  result.interactions=await require('./xlsx-window-interactions.cjs')(preview,files);result.checks.push('integrated frozen rows/columns, both-axis wheel, hidden cells, read-only typing/paste and keyboard copy');
  await preview.addStyleTag({content:'.xlsx-preview button{transition:none!important}'});
  const layering=async selector=>{
   await preview.locator(selector).hover();const tip=preview.locator('#one-tooltip.visible');await expect(tip).toBeVisible({timeout:5000});
   const layer=await tip.evaluate(el=>{const r=el.getBoundingClientRect(),pointer=el.style.pointerEvents;el.style.pointerEvents='auto';const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);el.style.pointerEvents=pointer;const content=document.querySelector('.xlsx-preview-surface').getBoundingClientRect();return {text:el.textContent,topmost:!!top?.closest('#one-tooltip'),overlapsWorkbook:r.left<content.right&&r.right>content.left&&r.top<content.bottom&&r.bottom>content.top,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};});assert.ok(layer.topmost,selector+' tooltip remains above workbook');assert.ok(layer.overlapsWorkbook,selector+' tooltip overlaps workbook content');return layer;
  };
  result.headerTooltip=await layering('#preview-minimize');result.footerTooltip=await layering('#preview-next');result.checks.push('header/footer tooltips above actual workbook surface');
  await preview.mouse.move(400,250);await preview.evaluate(async({url,key})=>{const shared=await import(url);shared[key]('XLSX_TOAST_LAYER_CHECK');},toastModule);const toast=preview.locator('#toast');await expect(toast).toBeVisible();
  result.toast=await toast.evaluate(el=>{const r=el.getBoundingClientRect(),pointer=el.style.pointerEvents;el.style.pointerEvents='auto';const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);el.style.pointerEvents=pointer;return {text:el.textContent,topmost:!!top?.closest('#toast')};});assert.ok(result.toast.topmost);result.checks.push('actual shared toast above workbook surface');
  await home.evaluate(()=>window.one.themeOneMode('dark'));await expect(preview.locator('html')).toHaveAttribute('data-theme','dark');
  const tab=preview.getByRole('button',{name:'日常报表',exact:true});await expect.poll(()=>tab.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(30, 30, 31)');result.dark=await tab.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,surface:getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),foreground:getComputedStyle(document.documentElement).getPropertyValue('--fg').trim()}));assert.notEqual(result.dark.background,'rgb(255, 255, 255)');assert.notEqual(result.dark.color,'rgb(0, 0, 0)');
  await home.evaluate(()=>window.one.themeOneMode('light'));await expect(preview.locator('html')).toHaveAttribute('data-theme','light');await expect.poll(()=>tab.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');result.checks.push('settings-driven dark/light workbook chrome');
  if(await preview.locator('#preview-files').getAttribute('aria-pressed')!=='true')await preview.locator('#preview-files').click();await preview.locator('#side-outline').click();await expect(preview.locator('.preview-outline-item')).toHaveCount(2);await preview.locator('.preview-outline-item').filter({hasText:'汇总'}).click();await expect.poll(async()=>{const rect=await preview.getByRole('region',{name:/Spreadsheet viewport/}).boundingBox();await preview.mouse.click(rect.x+100,rect.y+35);await preview.keyboard.press('Control+c');return preview.evaluate(()=>window.xlsxCopies.at(-1));}).toBe('SUMMARY_MARKER');result.checks.push('actual One sidebar switches visible worksheets');
  await preview.locator('#preview-next').click();await expect(preview.locator('#preview-name')).toHaveText('empty.xlsx');await expect(preview.locator('.xlsx-preview')).toHaveAttribute('data-state','ready');
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'plain.txt'));await expect(preview.locator('.cm-content')).toContainText('PLAIN_FILE_MARKER');await expect(preview.locator('.xlsx-preview')).toHaveCount(0);await preview.waitForFunction(()=>window.xlsxWorkers.created===window.xlsxWorkers.terminated,undefined,{timeout:20000});result.checks.push('file navigation and workbook-to-text release');
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'daily.xlsx'));await expect(preview.locator('.xlsx-preview')).toHaveAttribute('data-state','ready');
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=preview'));if(!window)throw Error('Preview window missing');window.setSize(900,680);});
  await preview.waitForFunction(()=>innerWidth<=900);result.layout=await preview.locator('.xlsx-preview-surface').evaluate(el=>({width:el.clientWidth,height:el.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth}));assert.ok(result.layout.width>250&&result.layout.height>250);assert.equal(result.layout.overflow,false);result.checks.push('device scale and resized layout');
  const total=await preview.evaluate(()=>window.xlsxWorkers.created);const closing=preview.waitForEvent('close');await preview.evaluate(()=>window.one.windowAction('close'));await closing;
  assert.ok(total>=4);result.checks.push('actual preview close');assert.deepEqual(result.errors,[]);assert.deepEqual(result.external,[]);result.passed=true;
 }catch(error){result.failure=error.stack?.slice(0,1500)||String(error);throw error;}
 finally{await fs.writeFile(path.join(root,'results-'+scale+'.json'),JSON.stringify(result,null,2));await app.close();}
 console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
