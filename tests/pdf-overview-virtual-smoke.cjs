const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createPDF}=require('./pdf-scroll-fixtures.cjs');

async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/pdf-overview-virtual');
 await fs.mkdir(output,{recursive:true});const pdf=path.join(output,'2050-pages.pdf');
 if(!await fs.stat(pdf).catch(()=>null))await createPDF(pdf,2050);
 const profile=await fs.mkdtemp(path.join(output,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.prototype.focus=function(){};BrowserWindow.prototype.show=function(){this.setPosition(-10000,-10000);this.showInactive();};for(const w of BrowserWindow.getAllWindows()){w.setPosition(-10000,-10000);w.showInactive();}});
  await main.evaluate(()=>window.one.patchSettings({preview:{held:true,files:true,leftTab:'overview'}}));
  const opening=app.waitForEvent('window',{predicate:page=>page.url().includes('view=preview')}),start=Date.now();
  await main.evaluate(file=>window.one.preview(file),pdf);const preview=await opening;
  await expect(preview.locator('.pdf-sheet')).toHaveCount(2050,{timeout:20000});
  await expect(preview.locator('#preview-overview .virtual-row-space')).toBeVisible();
  await expect.poll(()=>preview.locator('.preview-overview-card').count()).toBeGreaterThan(0);
  const initial=await preview.evaluate(()=>({dom:document.querySelectorAll('*').length,cards:document.querySelectorAll('.preview-overview-card').length}));
  assert.ok(initial.cards<30&&initial.dom<3000,JSON.stringify(initial));
  await expect(preview.locator('.preview-overview-card[data-page="0"] canvas')).toBeVisible();
  await preview.evaluate(()=>{window.firstOverviewCanvas=document.querySelector('.preview-overview-card[data-page="0"] canvas');});
  await preview.locator('#preview-overview').evaluate(host=>host.scrollTop=host.scrollHeight);
  const last=preview.locator('.preview-overview-card[data-page="2049"]');await expect(last).toBeVisible();await last.click();
  await expect(preview.locator('#pdf-page')).toHaveValue('2050');await expect(last).toHaveAttribute('aria-current','page');
  await preview.locator('#side-files').click();await preview.locator('#side-overview').click();
  await expect(last).toBeVisible();await expect(last).toHaveAttribute('aria-current','page');
  await preview.locator('#preview-overview').evaluate(host=>host.scrollTop=0);
  await expect(preview.locator('.preview-overview-card[data-page="0"] canvas')).toBeVisible();
  assert.equal(await preview.evaluate(()=>document.querySelector('.preview-overview-card[data-page="0"] canvas')===window.firstOverviewCanvas),true,'returning to a cached page reuses its thumbnail');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',pages:2050,...initial,readyMs:Date.now()-start,lastPageNavigation:true,currentPageRevealed:true,thumbnailReused:true}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
