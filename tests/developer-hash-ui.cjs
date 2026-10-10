const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {_electron:electron,expect}=require('@playwright/test');

test('developer hash tab computes, copies and verifies text and file digests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-developer-hash-')),source=join(root,'sample.bin'),profile=join(root,'profile');await writeFile(source,Buffer.from([0,1,2,3,255]));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-developer-hash').click();
  const sha=createHash('sha256').update('abc').digest('hex');await page.locator('#developer-hash-text').fill('abc');await page.locator('#developer-hash-expected').fill(sha.toUpperCase());await page.locator('#developer-hash-run').click();
  await expect(page.locator('#developer-hash-digest')).toHaveText(sha);await expect(page.locator('#developer-hash-match')).toHaveText('校验一致');await page.locator('#developer-hash-copy').click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),sha);
  await page.locator('#developer-hash-kind').selectOption('file');await expect(page.locator('#developer-hash-file-field')).toBeVisible();
  await page.locator('#developer-hash-file').evaluate((input,value)=>{input.value=value;},source);await page.locator('#developer-hash-algorithm').selectOption('md5');
  const md5=createHash('md5').update(Buffer.from([0,1,2,3,255])).digest('hex');await page.locator('#developer-hash-expected').fill('0'.repeat(32));await page.locator('#developer-hash-run').click();await expect(page.locator('#developer-hash-digest')).toHaveText(md5);await expect(page.locator('#developer-hash-match')).toHaveText('校验不一致');assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
