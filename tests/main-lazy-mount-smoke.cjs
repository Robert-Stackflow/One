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
  assert.deepEqual(await page.evaluate(()=>['input','search'].map(id=>document.querySelector('#page-'+id).childElementCount)),[0,0]);
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
  console.log(JSON.stringify({result:'PASS',mountedOnFirstVisit:true,statePreserved:true,keyboardTabs:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
