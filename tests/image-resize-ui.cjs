const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readdir,rm}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('resize tab applies percent, exact pixels and long-edge rules to a batch',async()=>{
 const root=await mkdtemp(path.resolve('work/current/image-resize-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),landscape=path.join(root,'landscape.png'),portrait=path.join(root,'portrait.png');
 await mkdir(output);await sharp({create:{width:120,height:80,channels:3,background:'red'}}).png().toFile(landscape);await sharp({create:{width:80,height:120,channels:3,background:'blue'}}).png().toFile(portrait);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},[landscape,portrait]);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-resize').click();
  await page.locator('#image-resize-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-resize-add').click();await expect(page.locator('#image-resize-count')).toContainText('2 张');
  await expect(page.locator('#image-resize-start')).toBeEnabled();await page.locator('#image-resize-start').click();await expect(page.locator('#image-resize-status')).toContainText('已完成 2 张');
  await expect(page.locator('#image-resize-results')).toContainText('60 × 40');await expect(page.locator('#image-resize-results')).toContainText('40 × 60');
  await page.locator('#image-resize-mode').click();await page.locator('#image-resize-mode-options [role="option"][aria-label="按像素"]').click();
  await page.locator('#image-resize-width').fill('60');await page.locator('#image-resize-height').fill('60');await page.locator('#image-resize-keep-aspect').uncheck();
  await page.locator('#image-resize-start').click();await expect(page.locator('#image-resize-status')).toContainText('已完成 2 张');
  await expect(page.locator('.image-resize-result-row').first()).toContainText('60 × 60');
  await page.locator('#image-resize-mode').click();await page.locator('#image-resize-mode-options [role="option"][aria-label="按长边"]').click();
  await page.locator('#image-resize-long-edge-value').fill('120');await expect(page.locator('#image-resize-keep-aspect')).toBeChecked();await expect(page.locator('#image-resize-keep-aspect')).toBeDisabled();
  await page.locator('#image-resize-start').click();await expect(page.locator('#image-resize-status')).toContainText('已完成 2 张');
  await expect(page.locator('#image-resize-results')).toContainText('120 × 80');await expect(page.locator('#image-resize-results')).toContainText('80 × 120');
  assert.equal((await readdir(output)).filter(name=>name.includes('-resized-')).length,6);assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
