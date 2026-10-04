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
  const deferred=['tools','text','disk','system','hardware','input','locksmith','preview','color','search','settings'];
  const initial=await page.evaluate(ids=>({nodes:document.querySelectorAll('*').length,empty:ids.map(id=>document.querySelector('#page-'+id).childElementCount)}),deferred);
  assert.deepEqual(initial.empty,deferred.map(()=>0),'unopened pages should not create hidden content');
  assert.ok(initial.nodes<450,'startup should keep only the overview and shared shell');
  const mounted={},mountMs={};
  for(const id of deferred){
   mountMs[id]=await page.evaluate(id=>{const start=performance.now();document.querySelector('[data-page='+id+']').click();return performance.now()-start;},id);
   await expect(page.locator('#page-'+id)).toBeVisible();
   mounted[id]=await page.locator('#page-'+id+' *').count();
   assert.ok(mounted[id]>0,id+' should mount on first visit');
   assert.ok(mountMs[id]<100,`${id} first visit blocked the UI for ${mountMs[id].toFixed(1)} ms`);
  }
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
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',initialNodes:initial.nodes,mounted,mountMs,statePreserved:true,keyboardTabs:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
