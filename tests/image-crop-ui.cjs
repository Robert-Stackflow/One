const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readdir,rm,writeFile}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('crop tab draws a fixed-ratio selection, applies it to a batch and previews output',async()=>{
 const root=await mkdtemp(path.resolve('work/current/image-crop-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),square=path.join(root,'square.png'),wide=path.join(root,'wide.png'),animated=path.join(root,'animated.gif');
 await mkdir(output);await sharp({create:{width:120,height:120,channels:3,background:'red'}}).png().toFile(square);await sharp({create:{width:240,height:120,channels:3,background:'blue'}}).png().toFile(wide);
 const frame=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).gif().toBuffer(),start=frame.indexOf(44);await writeFile(animated,Buffer.concat([frame.subarray(0,frame.length-1),frame.subarray(start,frame.length-1),Buffer.from([59])]));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE;
 const app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},[square,wide,animated]);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-crop').click();
  await page.locator('#image-crop-add').click();await expect(page.locator('#image-crop-count')).toContainText('3 张');
  await expect(page.locator('#image-crop-source-image')).toHaveAttribute('src',/^data:image\/png;base64,/);
  await expect(page.locator('#image-crop-selection')).toBeVisible();
  await page.locator('#image-crop-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-crop-ratio').click();await page.locator('#image-crop-ratio-options [role="option"][aria-label="1:1"]').click();
  const box=await page.locator('#image-crop-source-image').boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width*.15,box.y+box.height*.15);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75);await page.mouse.up();
  await expect(page.locator('#image-crop-bounds')).toContainText('选区');await expect(page.locator('#image-crop-start')).toBeEnabled();
  const chosenBounds=await page.locator('#image-crop-bounds').textContent();
  await page.locator('.image-crop-presets summary').click();await page.locator('#image-crop-preset-name').fill('方形头像');await page.locator('#image-crop-preset-save').click();
  await page.locator('.image-crop-preview .image-batch-preview summary').click();await page.locator('#image-crop-batch-load').click();
  await expect(page.locator('#image-crop-batch-grid .image-batch-card')).toHaveCount(3);
  await expect(page.locator('#image-crop-batch-grid')).toContainText('动图或多页图片不支持裁剪');
  await expect(page.locator('#image-crop-batch-grid')).toContainText('120 × 120 →');
  await page.locator('#image-crop-ratio').click();await page.locator('#image-crop-ratio-options [role="option"][aria-label="自由裁剪"]').click();
  await page.locator('#image-crop-preset').click();await page.locator('#image-crop-preset-options [role="option"][aria-label="方形头像"]').click();
  await expect(page.locator('#image-crop-bounds')).toHaveText(chosenBounds);
  await page.locator('#image-crop-start').click();await expect(page.locator('#image-crop-status')).toContainText('失败 1 张',{timeout:10000});
  await expect(page.locator('#image-crop-result-image')).toBeVisible();await expect(page.locator('#image-crop-retry')).toBeVisible();
  const outputs=(await readdir(output)).filter(name=>name.includes('-cropped-'));assert.equal(outputs.length,2);
  for(const name of outputs){const metadata=await sharp(path.join(output,name)).metadata();assert.equal(metadata.width,metadata.height);}
  await page.locator('[data-crop-result]').last().click();await expect(page.locator('#image-crop-result-name')).toContainText('wide-cropped');
  await page.locator('#image-crop-retry').click();await expect(page.locator('#image-crop-status')).toContainText('失败 1 张',{timeout:10000});
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
