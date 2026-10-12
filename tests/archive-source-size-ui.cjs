const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {fillArchiveSources}=require('./archive-ui-helpers.cjs');

async function main(){
 const base=path.resolve('work/temp');await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'archive-source-size-'));
 const profile=path.join(root,'profile'),file=path.join(root,'sample.txt'),folder=path.join(root,'folder'),missing=path.join(root,'missing.txt');
 let app;
 try{
  await fs.writeFile(file,'x'.repeat(22));await fs.mkdir(folder);await fs.writeFile(path.join(folder,'nested.txt'),'y'.repeat(11));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});
  const page=await app.firstWindow();await page.locator('.sidebar-group[aria-label="文件"] .nav').last().click();
  await expect(page.locator('#archive-source-total')).toHaveText('总大小 · 0 B');
  await fillArchiveSources(page,[file,folder,missing].join('\n'));
  await expect(page.locator('.archive-source-item-size')).toHaveText(['22 B','11 B','无法读取']);
  await expect(page.locator('#archive-source-total')).toHaveText('总大小 · 部分来源无法读取（已知 33 B）');
  await page.locator('[data-archive-source-remove="2"]').click();
  await expect(page.locator('#archive-source-total')).toHaveText('总大小 · 33 B');
  await page.locator('[data-archive-source-remove="1"]').click();
  await expect(page.locator('#archive-source-total')).toHaveText('总大小 · 22 B');
  assert.equal(await page.locator('.archive-source-item-size').count(),1);
  console.log('Archive source sizes and total verified.');
 }finally{
  if(app)await app.close();
  if(root.startsWith(base+path.sep))await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
