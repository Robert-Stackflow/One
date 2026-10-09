const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test'),{testArchive}=require('./archive-ui-helpers.cjs'),{rekey}=require('./archive-zipx-password.cjs');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-zipx-password-ui-'));let app;
 try{
  const fixtureRoot=path.resolve('tests/fixtures/archives/encrypted-zip');
  const cases=[{method:'bzip2',encoding:949,password:' 한국어 암호 ',label:'韩文 / CP949'},{method:'ppmd',encoding:65001,password:' 中文 한국어 🔒 ',label:'UTF-8（默认）'}];
  for(const item of cases){item.source=path.join(root,item.method+'.zipx');const bytes=await fs.readFile(path.join(fixtureRoot,'sevenzip-aes256-'+item.method+'.zipx'));await fs.writeFile(item.source,rekey(bytes,'secret',item.password,item.encoding));}
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  for(const item of cases){
   await page.locator('#archive-source').fill(item.source);await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(1);await expect(page.locator('#archive-open')).toBeEnabled();
   await page.locator('#archive-decode-open').click();await expect(page.locator('#archive-password-encoding-row')).toBeVisible();await page.locator('#archive-password').fill(item.password);await page.locator('#archive-password-encoding').click();await page.getByRole('option',{name:item.label,exact:true}).click();await page.locator('#archive-decode-done').click();await expect(page.locator('#archive-decode-dialog')).toBeHidden();await expect(page.locator('#archive-open')).toBeEnabled();
   await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');assert.equal(await fs.readFile(path.join(root,item.method,'payload.txt'),'utf8'),'Independent encrypted ZIPX method fixture\n'.repeat(64));
  }
  assert.deepEqual(errors,[]);console.log('ZIPX password UI passed: visible encoding selector, CP949 Korean BZIP2, UTF8+emoji PPMd8, integrity testing and exact extraction.');
 }finally{await app?.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
