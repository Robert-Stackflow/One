const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const zlib=require('node:zlib');
const {_electron:electron,expect}=require('@playwright/test');
const {testArchive}=require('./archive-ui-helpers.cjs');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-formats-ui-'));let app;
 try{
  const cabOption=process.argv.indexOf('--cab-volumes'),cabVolumes=cabOption<0?undefined:process.argv[cabOption+1];
  if(cabOption>=0)assert(cabVolumes,'--cab-volumes requires a complete four-volume fixture directory');
  if(cabVolumes)for(const name of ['part1.cab','part2.cab','part3.cab','part4.cab'])await fs.copyFile(path.resolve(cabVolumes,name),path.join(root,name));
  const directory=path.resolve('tests/fixtures/archives'),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  const names=['test_read_format_cab_1.cab','test_read_format_lha_bugfix_0.lzh','test_read_format_iso_joliet_by_nero.iso','payload.wim','payload.txt.bz2','payload.tar.bz2','test_compat_zstd_1.tar.zst','test_read_format_zip_zstd.zipx'];
  for(const name of names){const item=manifest.files.find(item=>item.name===name),bytes=await fs.readFile(path.join(directory,item.stored));await fs.writeFile(path.join(root,name),item.stored.endsWith('.gz')?zlib.gunzipSync(bytes):bytes);}
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  for(const name of names){
   await page.locator('#archive-source').fill(path.join(root,name));await page.locator('#archive-open').click();await expect.poll(()=>page.locator('.archive-entry').count()).toBeGreaterThan(0);await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('#archive-editor')).toBeHidden();
   if(name==='payload.txt.bz2'){await expect(page.locator('.archive-entry')).toContainText('未知大小');await page.locator('.archive-entry-details-button').click();await expect(page.locator('#archive-entry-details')).toContainText('未知大小');await page.locator('#archive-entry-details [data-dialog-dismiss]').last().click();}
   await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
  }
  // Exercise actual extraction and the basename of a newly supported wrapper.
  await page.locator('#archive-source').fill(path.join(root,'payload.tar.bz2'));await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(1);await expect(page.locator('#archive-open')).toBeEnabled();await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-all').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');assert.match(await fs.readFile(path.join(root,'payload/payload.txt'),'utf8'),/中文内容/);
  if(cabVolumes){
   await page.locator('#archive-source').fill(path.join(root,'part2.cab'));await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(2);await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('#archive-editor')).toBeHidden();
   await testArchive(page);await expect(page.locator('#archive-status-text')).toContainText('校验完成');
   await page.locator('.archive-entry').filter({hasText:'tail.txt'}).locator('input').check();await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-selected').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');
   assert.equal(await fs.readFile(path.join(root,'part2/tail.txt'),'utf8'),'CAB spanning independent writer\r\n');assert.deepEqual(await fs.readdir(path.join(root,'part2')),['tail.txt']);
   await fs.unlink(path.join(root,'part3.cab'));await page.locator('#archive-open').click();await expect(page.locator('#archive-status-text')).toContainText('头部');await expect(page.locator('.archive-entry')).toHaveCount(0);await expect(page.locator('#archive-extract-selected')).toBeDisabled();
  }
  assert.deepEqual(errors,[]);console.log('Archive read-format UI passed: eight real format samples browse/test with editing hidden; TAR.BZ2 extraction and target basename verified.'+(cabVolumes?' CAB later-volume browse/test, selected extraction and missing-volume invalidation passed.':''));
 }finally{await app?.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
