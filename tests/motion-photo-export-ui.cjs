const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {fixtures}=require('./image-preview-fixtures.cjs');
const JSZip=require('jszip');

test('preview exports the exact motion photo movie in the Windows app',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-motion-export-ui-')),files=join(root,'files'),profile=join(root,'profile'),output=join(root,'exported.mp4');
  const {photo,movie}=await fixtures(files),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
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
  assert.deepEqual(await readFile(output),movie);
  const archive=new JSZip();archive.file('IMG_1.JPG.jpeg',photo,{compression:'STORE'});archive.file('IMG_1.JPG.mov',movie,{compression:'STORE'});
  const livp=join(files,'export.livp');await require('node:fs/promises').writeFile(livp,await archive.generateAsync({type:'nodebuffer',compression:'STORE'}));
  await page.evaluate(path=>window.one.selectPreview(path),livp);
  await expect(page.locator('#preview-status-kind')).toHaveText('动态照片');
  await expect.poll(()=>page.locator('.photo-visual img').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#image-motion')).toBeVisible();
  await page.locator('#image-motion').click();
  await expect.poll(()=>page.locator('.motion-photo-video').evaluate(video=>video.currentTime)).toBeGreaterThan(0);
  const extracted=join(root,'livp-video.mp4');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},extracted);
  await page.locator('#image-export-motion').click();
  await expect(page.locator('#preview-details-list')).toContainText('已导出 livp-video.mp4');
  assert.deepEqual(await readFile(extracted),movie);
  const heicArchive=new JSZip();heicArchive.file('IMG_2.heic',await readFile(join(files,'heic-motion.heic')),{compression:'STORE'});heicArchive.file('IMG_2.mov',movie,{compression:'STORE'});
  const heicLivp=join(files,'heic-export.livp');await require('node:fs/promises').writeFile(heicLivp,await heicArchive.generateAsync({type:'nodebuffer',compression:'STORE'}));
  await page.evaluate(path=>window.one.selectPreview(path),heicLivp);
  await expect(page.locator('#preview-status-kind')).toHaveText('动态照片');
  await expect(page.locator('#image-motion')).toBeVisible();
  await expect(page.locator('.photo-visual canvas')).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
