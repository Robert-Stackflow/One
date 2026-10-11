const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readFile,rm}=require('node:fs/promises');
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
  await page.evaluate(()=>{document.querySelector('#image-color-extract').click();document.querySelector('#image-color-extract-cancel').click();});await expect(page.locator('#image-color-palette-status')).toHaveText('已取消');
  await page.locator('#image-color-extract').click();await expect(page.locator('#image-color-swatches button')).toHaveCount(2);await expect(page.locator('#image-color-palette-status')).toHaveText('已提取 2 种颜色');
  await expect(page.locator('[data-palette-color="#FF0000"]')).toContainText('50%');await expect(page.locator('[data-palette-color="#0000FF"]')).toContainText('50%');
  await page.locator('[data-palette-color="#0000FF"]').click();await expect(page.locator('#image-color-palette [data-color-label]')).toHaveText('#0000FF');
  await page.locator('#image-color-palette-copy').click();assert.deepEqual((await app.evaluate(({clipboard})=>clipboard.readText())).split('\n').sort(),['#0000FF','#FF0000']);
  const destination=path.join(root,'exports');await mkdir(destination);const opening=app.waitForEvent('window');await page.locator('#image-color-palette-export').click();const picker=await opening;await picker.locator('#picker-path').fill(destination);await picker.locator('#picker-go').click();await expect(picker.locator('#picker-name')).toHaveValue('调色板.json');await picker.locator('#picker-confirm').click();await expect.poll(async()=>readFile(path.join(destination,'调色板.json'),'utf8').then(text=>JSON.parse(text).colors.length).catch(()=>-1)).toBe(2);
  for(const width of [700,900,1280]){await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('view=main')).setSize(w,720),width);assert.equal(await page.evaluate(()=>{const content=document.querySelector('.content'),button=document.querySelector('#image-color-extract'),rect=button.getBoundingClientRect();return content.scrollWidth<=content.clientWidth+1&&rect.right<=innerWidth&&rect.top<innerHeight;}),true,`image palette layout ${width}`);}
  const box=await page.locator('#image-color-image').boundingBox();assert.ok(box);
  await page.mouse.click(box.x+box.width*.25,box.y+box.height*.5);await expect(page.locator('#image-color-palette [data-color-label]')).toHaveText('#FF0000');
  await expect(page.locator('#image-color-position')).toContainText('· #FF0000 ·');
  await page.locator('#image-color-palette [data-color-copy="rgb"]').click();
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'rgb(255, 0, 0)');
  await page.locator('#image-color-palette [data-color-save]').click();await expect(page.locator('#image-color-palette [data-color-history]')).toContainText('#FF0000');
  await page.mouse.click(box.x+box.width*.75,box.y+box.height*.5);await expect(page.locator('#image-color-palette [data-color-label]')).toHaveText('#0000FF');
  await page.locator('#tool-tab-color').click();await expect(page.locator('#color-history')).toContainText('#FF0000');
  const other=path.join(root,'green.png');await sharp({create:{width:20,height:20,channels:3,background:'#00FF00'}}).png().toFile(other);await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},other);await page.locator('#tool-tab-image-color').click();await page.locator('#image-color-open').click();await expect(page.locator('#image-color-name')).toHaveText('green.png');await expect(page.locator('#image-color-extracted')).toBeHidden();await page.locator('#image-color-extract').click();await expect(page.locator('#image-color-swatches button')).toHaveCount(1);await expect(page.locator('[data-palette-color="#00FF00"]')).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
