const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readdir,rm}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('image conversion tab converts a picked file and reports results',async()=>{
 const root=await mkdtemp(path.resolve('work/current/image-convert-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'source.png');
 await mkdir(output);await sharp({create:{width:12,height:12,channels:4,background:'red'}}).png().toFile(source);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE;
 const app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]});},source);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-convert').click();
  await expect(page.locator('#page-image-convert')).toBeVisible();await expect(page.locator('#color-heading-actions')).toBeHidden();
  await page.locator('#image-convert-add').click();await expect(page.locator('#image-convert-count')).toContainText('1 张');
  await page.locator('#image-convert-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-convert-format').click();await page.locator('#image-convert-format-options [role="option"][aria-label="JPEG"]').click();
  await page.locator('#image-convert-width').fill('6');await page.locator('#image-convert-start').click();
  await expect(page.locator('#image-convert-status')).toContainText('已完成 1 张');
  await expect(page.locator('.image-convert-file-state')).toHaveText('已完成');
  const names=await readdir(output);assert.equal(names.filter(name=>name.endsWith('.jpg')).length,1);
  assert.equal((await sharp(path.join(output,names.find(name=>name.endsWith('.jpg')))).metadata()).width,6);
  await page.locator('#image-convert-format').click();await page.locator('#image-convert-format-options [role="option"][aria-label="保持原格式（压缩）"]').click();
  await expect(page.locator('#image-convert-start')).toHaveText('开始压缩');await page.locator('#image-convert-start').click();
  await expect(page.locator('#image-convert-status')).toContainText('已完成 1 张');
  const compressed=(await readdir(output)).find(name=>name.includes('-compressed-')&&name.endsWith('.png'));assert.ok(compressed);
  assert.equal((await sharp(path.join(output,compressed)).metadata()).width,6);
  await page.locator('#tool-tab-color').click();await expect(page.locator('#color-heading-actions')).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
