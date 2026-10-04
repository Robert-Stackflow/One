const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/main-lazy-mount-smoke');
 await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(output,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const page=await app.firstWindow();await page.waitForSelector('#overview-index');
  const scriptRequests=[];page.on('request',request=>{if(request.url().endsWith('.js'))scriptRequests.push(request.url());});
  await page.reload();await page.waitForSelector('#overview-index');
  const deferredModules=['file-tools-view','text-view','disk-view','maintenance-view','system-info-view','enhancement-view','locksmith-view','color-view','search-view','settings-view'];
  const moduleRequest=(url,name)=>new RegExp('/'+name+'-[^/]+\\.js$').test(url);
  assert.ok(!scriptRequests.some(url=>deferredModules.some(name=>moduleRequest(url,name))),'unopened page scripts should load only when opened');
  const deferred=['tools','text','disk','system','hardware','input','locksmith','preview','color','search','settings'];
  const initial=await page.evaluate(ids=>({nodes:document.querySelectorAll('*').length,empty:ids.map(id=>document.querySelector('#page-'+id).childElementCount)}),deferred);
  assert.deepEqual(initial.empty,deferred.map(()=>0),'unopened pages should not create hidden content');
  assert.ok(initial.nodes<450,'startup should keep only the overview and shared shell');
  const mounted={},mountMs={};
  for(const id of deferred){
   mountMs[id]=await page.evaluate(async id=>{const start=performance.now();document.querySelector('[data-page='+id+']').click();while(document.querySelector('#page-'+id).hidden){if(performance.now()-start>3000)throw Error(id+' page did not open');await new Promise(requestAnimationFrame);}return performance.now()-start;},id);
   await expect(page.locator('#page-'+id)).toBeVisible();
   mounted[id]=await page.locator('#page-'+id+' *').count();
   assert.ok(mounted[id]>0,id+' should mount on first visit');
   assert.ok(mountMs[id]<200,`${id} first visit took ${mountMs[id].toFixed(1)} ms`);
  }
  assert.ok(deferredModules.every(name=>scriptRequests.some(url=>moduleRequest(url,name))),'first visits should load their page scripts');
  await page.locator('[data-page=home]').click();
  await expect(page.locator('#page-home')).toBeVisible();
  assert.equal(await page.locator('#page-tools *').count(),mounted.tools,'mounted page should retain its state');
  await page.locator('[data-page=input]').click();
  await expect(page.locator('#enhancement-tab-quick')).toBeVisible();
  await expect(page.locator('.enhancement-tabs')).toHaveClass(/segment-ready/);
  await page.locator('#enhancement-tab-edges').click();
  await expect(page.locator('#enhancement-tab-edges')).toHaveAttribute('aria-selected','true');
  await page.locator('[data-page=search]').click();
  await expect(page.locator('#search-tab-entry')).toBeVisible();
  await expect(page.locator('#index-summary')).not.toBeEmpty();
  await page.locator('#search-tab-index').click();
  await expect(page.locator('#search-tab-index')).toHaveAttribute('aria-selected','true');
  await page.locator('[data-page=input]').click();
  await expect(page.locator('#enhancement-tab-edges')).toHaveAttribute('aria-selected','true');
  await page.locator('[data-page=search]').click();
  await expect(page.locator('#search-tab-index')).toHaveAttribute('aria-selected','true');
  await page.locator('#search-tab-index').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#search-tab-menu')).toHaveAttribute('aria-selected','true');
  await page.evaluate(()=>{document.querySelector('[data-page=locksmith]').click();document.querySelector('[data-page=input]').click();});
  await expect(page.locator('#page-input')).toBeVisible();
  await expect(page.locator('#page-locksmith')).toBeHidden();
  await page.reload();await page.waitForSelector('#overview-index');
  assert.equal(await page.locator('#page-text').evaluate(e=>e.childElementCount),0);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).webContents.send('one:receive-text','首次进入文本处理'));
  await expect(page.locator('#page-text')).toBeVisible();
  await expect.poll(()=>page.locator('#source').evaluate(e=>e.value)).toBe('首次进入文本处理');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',initialNodes:initial.nodes,mounted,mountMs,statePreserved:true,keyboardTabs:true,coldTextEntry:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
