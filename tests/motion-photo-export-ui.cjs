const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {fixtures}=require('./image-preview-fixtures.cjs');

test('preview exports the exact motion photo movie in the Windows app',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-motion-export-ui-')),files=join(root,'files'),profile=join(root,'profile'),output=join(root,'exported.mp4');
 const {movie}=await fixtures(files),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const main=await app.firstWindow(),errors=[];main.on('pageerror',error=>errors.push(error.message));
  const opening=app.waitForEvent('window',{predicate:page=>page.url().includes('view=preview')});
  await main.evaluate(path=>window.one.preview(path),join(files,'google-old.jpg'));
  const page=await opening;page.on('pageerror',error=>errors.push(error.message));
  await expect(page.locator('#image-export-motion')).toBeVisible();
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
  await page.locator('#image-export-motion').click();
  await expect(page.locator('#preview-details-list')).toContainText('已导出 exported.mp4');
  assert.deepEqual(await readFile(output),movie);assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
