const {test}=require('node:test');
const {expect,_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const sharp=require('sharp');

test('image metadata tab removes selected groups and reveals a verified copy',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'one-metadata-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'photo.jpg');await mkdir(output);
 await sharp({create:{width:12,height:8,channels:3,background:'#d36382'}}).jpeg().toFile(source);
 const write=spawnSync(require('exiftool-vendored.exe'),['-overwrite_original','-Artist=One Test','-GPSLatitude=12.34','-GPSLatitudeRef=N',source],{encoding:'utf8'});assert.equal(write.status,0,write.stderr||write.stdout);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-metadata').click();await page.locator('#image-metadata-add').click();
  await expect(page.locator('#image-metadata-count')).toHaveText('已选择 1 张图片');
  await page.locator('#image-metadata-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-metadata-start').click();await expect(page.locator('#image-metadata-status')).toHaveText('已完成 1 张',{timeout:30000});
  await expect(page.locator('#image-metadata-files')).toContainText('已核验所选元数据与色彩配置');await expect(page.locator('#image-metadata-files [data-image-reveal]')).toHaveCount(1);
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
