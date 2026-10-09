const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {testArchive}=require('./archive-ui-helpers.cjs');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-alz-ui-'));let app;
 try{
  for(const name of ['methods.alz','korean-password.alz','utf8.alz'])await fs.copyFile(path.join('tests/fixtures/archives/alz',name),path.join(root,name));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  await page.locator('#archive-source').fill(path.join(root,'methods.alz'));await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(3);await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('#archive-editor')).toBeHidden();
  const dlz=page.locator('.archive-entry').filter({hasText:'dlz.txt'});await dlz.locator('.archive-entry-details-button').click();await expect(page.locator('#archive-entry-details')).toContainText('BZip2');await page.locator('#archive-entry-details [data-dialog-dismiss]').last().click();
  await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
  await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');assert.equal(await fs.readFile(path.join(root,'methods/folder/stored.txt'),'utf8'),'stored\n');
  await page.locator('#archive-source').fill(path.join(root,'korean-password.alz'));await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(1);await expect(page.locator('.archive-entry')).toContainText('비밀.txt');await expect(page.locator('#archive-open')).toBeEnabled();
  await page.locator('#archive-decode-open').click();await expect(page.locator('#archive-alz-encoding-note')).toContainText('CP949');await expect(page.locator('#archive-password-encoding-row')).toBeHidden();await page.locator('#archive-password').fill('비밀');await page.locator('#archive-encoding').click();await page.getByRole('option',{name:'韩文 / CP949',exact:true}).click();await page.locator('#archive-decode-done').click();await expect(page.locator('#archive-decode-dialog')).toBeHidden();await expect(page.locator('#archive-open')).toBeEnabled();
  await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
  await page.locator('#archive-source').fill(path.join(root,'utf8.alz'));await page.locator('#archive-decode-open').click();await page.locator('#archive-password').fill('');await page.locator('#archive-encoding').click();await page.getByRole('option',{name:'UTF-8',exact:true}).click();await page.locator('#archive-decode-done').click();await expect(page.locator('#archive-decode-dialog')).toBeHidden();await expect(page.locator('.archive-entry')).toHaveCount(1);await expect(page.locator('.archive-entry')).toContainText('文件.txt');await expect(page.locator('#archive-open')).toBeEnabled();
  await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');assert.deepEqual(errors,[]);
  await page.locator('#archive-source').fill(path.resolve('tests/fixtures/archives/alz-split/split_store.a01'));await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(4);await expect(page.locator('#archive-open')).toBeEnabled();await page.locator('#archive-decode-open').click();await expect(page.locator('#archive-alz-encoding-note')).toContainText('CP949');await page.locator('#archive-decode-dialog-close').click();await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
  await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');assert.equal((await fs.stat(path.join(root,'split_store/part3.bin'))).size,40000);assert.deepEqual(errors,[]);
  for(const [name,password,count,output] of [['mixed.alz','secret',4,'mixed/legacy.bin'],['empty-date.alz','secret',1,'empty-date/empty.txt'],['date-korean.alz','비밀',1,'date-korean/korean.txt']]){
   await page.locator('#archive-source').fill(path.resolve('tests/fixtures/archives/alz-variants',name));await page.locator('#archive-decode-open').click();await page.locator('#archive-password').fill(password);await page.locator('#archive-encoding').click();await page.getByRole('option',{name:'韩文 / CP949',exact:true}).click();await page.locator('#archive-decode-done').click();await expect(page.locator('#archive-decode-dialog')).toBeHidden();await expect(page.locator('.archive-entry')).toHaveCount(count);await expect(page.locator('#archive-open')).toBeEnabled();
   await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');const info=await fs.stat(path.join(root,output));assert(info.isFile());if(name==='empty-date.alz')assert.equal(info.size,0);
  }
  assert.deepEqual(errors,[]);console.log('ALZ UI passed: read-only browse/details, all methods, extraction, CP949 password, UTF-8 filename, later split volume, per-member date/CRC and encrypted empty files.');
 }finally{await app?.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
