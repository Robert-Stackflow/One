const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('image color tab samples original pixels and shares palette formats and history',async()=>{
 const root=await mkdtemp(path.resolve('work/current/image-color-ui-')),profile=path.join(root,'profile'),source=path.join(root,'colors.png');
 const pixels=Buffer.alloc(100*100*3);for(let y=0;y<100;y++)for(let x=0;x<100;x++){const index=(y*100+x)*3;pixels[index]=x<50?255:0;pixels[index+2]=x<50?0:255;}await sharp(pixels,{raw:{width:100,height:100,channels:3}}).png().toFile(source);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-color').click();await page.locator('#image-color-open').click();
  await expect(page.locator('#image-color-image')).toHaveAttribute('src',/^data:image\/png;base64,/);
  const box=await page.locator('#image-color-image').boundingBox();assert.ok(box);
  await page.mouse.click(box.x+box.width*.25,box.y+box.height*.5);await expect(page.locator('#image-color-palette [data-color-label]')).toHaveText('#FF0000');
  await expect(page.locator('#image-color-position')).toContainText('· #FF0000 ·');
  await page.locator('#image-color-palette [data-color-copy="rgb"]').click();
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'rgb(255, 0, 0)');
  await page.locator('#image-color-palette [data-color-save]').click();await expect(page.locator('#image-color-palette [data-color-history]')).toContainText('#FF0000');
  await page.mouse.click(box.x+box.width*.75,box.y+box.height*.5);await expect(page.locator('#image-color-palette [data-color-label]')).toHaveText('#0000FF');
  await page.locator('#tool-tab-color').click();await expect(page.locator('#color-history')).toContainText('#FF0000');
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
