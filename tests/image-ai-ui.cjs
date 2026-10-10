const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,copyFile,readdir,rm}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('image AI tab runs cached CPU model and shows transparent output',async()=>{
 const model=process.env.ONE_AI_MODEL;if(!model)throw Error('Set ONE_AI_MODEL to the verified u2netp.onnx path');
 const firstDownload=process.env.ONE_TEST_AI_DOWNLOAD==='1';
 const root=await mkdtemp(path.resolve('work/current/image-ai-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'source.png');
 await mkdir(path.join(profile,'models'),{recursive:true});await mkdir(output);
 if(!firstDownload)await copyFile(model,path.join(profile,'models','u2netp-309c8469258d.onnx'));
 const pixels=Buffer.alloc(320*320*3,255);for(let y=70;y<250;y++)for(let x=70;x<250;x++){const index=(y*320+x)*3;pixels[index]=30;pixels[index+1]=70;pixels[index+2]=160;}
 await sharp(pixels,{raw:{width:320,height:320,channels:3}}).png().toFile(source);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]});},source);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-ai').click();await expect(page.locator('#page-image-ai')).toBeVisible();
  await expect(page.locator('#image-ai-model')).toContainText(firstDownload?'首次使用':'已缓存');await page.locator('#image-ai-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-ai-pick').click();await expect(page.locator('#image-ai-source')).toContainText('source.png');
  await page.locator('#image-ai-start').click();await expect(page.locator('#image-ai-status')).toContainText('去背景完成',{timeout:firstDownload?90000:30000});await expect(page.locator('#image-ai-result')).toHaveAttribute('src',/^data:image\/png;base64,/);
  const names=await readdir(output),result=names.find(name=>name.endsWith('.png'));assert.ok(result);
  const image=await sharp(path.join(output,result)).metadata();assert.equal(image.width,320);assert.equal(image.height,320);assert.equal(image.hasAlpha,true);assert.deepEqual(errors,[]);
  if(firstDownload)assert.equal((await require('node:fs/promises').stat(path.join(profile,'models','u2netp-309c8469258d.onnx'))).size,4574861);
  const cancelled=await page.evaluate(({source,output})=>new Promise(resolve=>{let stopping=false;const unsubscribe=window.one.onImageAiProgress(progress=>{if(progress.phase==='process'&&!stopping){stopping=true;void window.one.imageAiCancel();}});void window.one.imageAiStart(source,output).then(()=>{unsubscribe();resolve(false);},()=>{unsubscribe();resolve(true);});}),{source,output});
  assert.equal(cancelled,true);assert.equal((await readdir(output)).filter(name=>name.endsWith('.png')).length,1);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
