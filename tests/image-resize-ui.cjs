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
  await page.locator('.image-resize-presets summary').click();await page.locator('#image-resize-preset-name').fill('半尺寸');await page.locator('#image-resize-preset-save').click();
  await page.locator('.image-resize-output .image-batch-preview summary').click();await page.locator('#image-resize-batch-load').click();
  await expect(page.locator('#image-resize-batch-grid .image-batch-card')).toHaveCount(2);
  await expect(page.locator('#image-resize-batch-grid')).toContainText('120 × 80 → 60 × 40');
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
  await page.locator('#image-resize-preset').click();await page.locator('#image-resize-preset-options [role="option"][aria-label="半尺寸"]').click();
  await expect(page.locator('#image-resize-batch-grid')).toContainText('120 × 80 → 60 × 40');
  assert.equal((await readdir(output)).filter(name=>name.includes('-resized-')).length,6);assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

test('resize batch preview loads at most eight images per page',async()=>{
 const root=await mkdtemp(path.resolve('work/current/image-resize-pages-')),profile=path.join(root,'profile');
 const files=Array.from({length:9},(_,index)=>path.join(root,`image-${index+1}.png`));
 await Promise.all(files.map(file=>sharp({create:{width:40,height:20,channels:3,background:'green'}}).png().toFile(file)));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:selected});},files);
  const page=await app.firstWindow();await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-resize').click();
  await page.locator('#image-resize-add').click();await expect(page.locator('#image-resize-count')).toContainText('9 张');
  await page.locator('.image-resize-output .image-batch-preview summary').click();await page.locator('#image-resize-batch-load').click();
  await expect(page.locator('#image-resize-batch-grid .image-batch-card img')).toHaveCount(8);
  await expect(page.locator('#image-resize-batch-position')).toHaveText('1 / 2');
  await page.locator('#image-resize-batch-next').click();await expect(page.locator('#image-resize-batch-grid .image-batch-card img')).toHaveCount(1);
  await expect(page.locator('#image-resize-batch-grid')).toContainText('image-9.png');
  await expect(page.locator('#image-resize-batch-position')).toHaveText('2 / 2');
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
