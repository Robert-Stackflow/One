const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {testArchive,setArchivePassword}=require('./archive-ui-helpers.cjs');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-egg-ui-'));let app;
 try{
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  const source=name=>path.resolve('tests/fixtures/archives/egg',name);
  const open=async(name,count)=>{await page.locator('#archive-source').fill(source(name));await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(count);await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('#archive-editor')).toBeHidden();};
  await open('azoshort_txt.egg',1);await page.locator('.archive-entry-details-button').click();await expect(page.locator('#archive-entry-details')).toContainText('AZO');await page.locator('#archive-entry-details [data-dialog-dismiss]').last().click();
  await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
  await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');assert.equal((await fs.readFile(path.join(root,'azoshort_txt/azoshorttxt.sys'))).length,128);
  await open('test256.egg',1);await page.locator('#archive-decode-open').click();await expect(page.locator('#archive-alz-encoding-note')).toContainText('EGG');await expect(page.locator('#archive-password-encoding-row')).toBeHidden();await page.locator('#archive-password').fill('password12345!');await page.locator('#archive-decode-done').click();await expect(page.locator('#archive-decode-dialog')).toBeHidden();await expect(page.locator('#archive-open')).toBeEnabled();
  await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');await setArchivePassword(page,'');
  for(const [name,text] of [['small_kor.egg','작은.txt'],['small_shift.egg','小さい.txt']]){await open(name,1);await expect(page.locator('.archive-entry')).toContainText(text);await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');}
  await open('number.vol2.egg',1);await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
  await open('globalcomment.egg',1);await expect(page.locator('#archive-status-text')).not.toContainText('失败');assert.deepEqual(errors,[]);
  console.log('EGG UI passed: read-only browse/details, AZO extraction, AES password, encoding guidance, declared Korean/Japanese names and later-volume opening.');
 }finally{await app?.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
