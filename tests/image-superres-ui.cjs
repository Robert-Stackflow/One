const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,copyFile,readdir,rm}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('super-resolution tab runs cached CPU model and preserves alpha',async()=>{
 const model=process.env.ONE_SUPERRES_MODEL;if(!model)throw Error('Set ONE_SUPERRES_MODEL to the verified ONNX model path');
 const firstDownload=process.env.ONE_TEST_SUPERRES_DOWNLOAD==='1';
 const root=await mkdtemp(path.resolve('work/current/image-superres-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'source.png'),second=path.join(root,'second.png'),longSource=path.join(root,'long.png');
 await mkdir(path.join(profile,'models'),{recursive:true});await mkdir(output);
 if(!firstDownload)await copyFile(model,path.join(profile,'models','realesr-general-x4v3-4ca39b3a965e.onnx'));
 const pixels=Buffer.alloc(128*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<128;x++){const index=(y*128+x)*4;pixels[index]=x*2;pixels[index+1]=y*4;pixels[index+2]=80;pixels[index+3]=x<12?0:255;}
 await sharp(pixels,{raw:{width:128,height:64,channels:4}}).png().toFile(source);
 await sharp({create:{width:64,height:64,channels:4,background:'#5588bb'}}).png().toFile(second);
 await sharp({create:{width:512,height:512,channels:3,background:'#5588bb'}}).png().toFile(longSource);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 let appExit,windowClosed=false;app.process().on('exit',(code,signal)=>{appExit={code,signal};});
 try{
  await app.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:chosen});},[source,second]);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('close',()=>{windowClosed=true;});
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-superres').click();await expect(page.locator('#page-image-superres')).toBeVisible();
  await expect(page.locator('#image-superres-model')).toContainText(firstDownload?'首次使用':'已缓存');await page.locator('#image-superres-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-superres-pick').click();await expect(page.locator('#image-superres-source')).toContainText('source.png');
  await page.locator('#image-superres-start').click();await expect(page.locator('#image-superres-status')).toContainText('4× 超分完成：成功 2，失败 0',{timeout:firstDownload?90000:30000});
  await expect(page.locator('#image-superres-result')).toHaveAttribute('src',/^data:image\/png;base64,/);
  await expect(page.locator('#image-superres-batch-list button')).toHaveCount(2);await page.locator('#image-superres-batch-list button').first().click();await expect(page.locator('#image-superres-detail')).toContainText('512 × 256');await page.locator('#image-superres-batch-list button').last().click();await expect(page.locator('#image-superres-detail')).toContainText('256 × 256');
  const files=(await readdir(output)).filter(value=>value.endsWith('.png')),name=files.find(value=>value.startsWith('source-'));assert.equal(files.length,2);assert.ok(name);
  const metadata=await sharp(path.join(output,name)).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,256);assert.equal(metadata.hasAlpha,true);
  if(firstDownload)assert.equal((await require('node:fs/promises').stat(path.join(profile,'models','realesr-general-x4v3-4ca39b3a965e.onnx'))).size,4945202);
  const cancelled=await page.evaluate(({source,output})=>new Promise(resolve=>{let stopping=false;const off=window.one.onImageSuperresProgress(progress=>{if(progress.phase==='process'&&progress.done>=2&&!stopping){stopping=true;void window.one.imageAiCancel();}});void window.one.imageSuperresStart(source,output).then(()=>{off();resolve(false);},()=>{off();resolve(true);});}),{source:longSource,output});
  assert.equal(cancelled,true);assert.equal((await readdir(output)).filter(value=>value.endsWith('.png')).length,2);assert.deepEqual(errors,[]);
  await app.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:chosen});},[longSource,second]);
  await page.locator('#image-superres-pick').click();await page.locator('#image-superres-start').click();await expect(page.locator('#image-superres-status')).toContainText('正在超分',{timeout:30000});await page.locator('#image-superres-cancel').click();await expect(page.locator('#image-superres-status')).toContainText('已取消',{timeout:30000});
  await expect(page.locator('#image-superres-batch-list button').last()).toContainText('待处理');assert.equal((await readdir(output)).filter(value=>value.endsWith('.png')).length,2);
  await page.setViewportSize({width:700,height:850});const overflow=await page.locator('#page-image-superres').evaluate(element=>({scroll:element.scrollWidth,client:element.clientWidth}));assert.ok(overflow.scroll<=overflow.client+1,JSON.stringify(overflow));
 }catch(error){console.error('superres-ui-state',JSON.stringify({appExit,windowClosed}));throw error;}finally{await app.close();await rm(root,{recursive:true,force:true});}
});
