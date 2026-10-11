const assert=require('node:assert/strict');
const path=require('node:path');
const {mkdtemp,mkdir,copyFile,readdir,rm,stat,readFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {_electron:electron,expect}=require('@playwright/test');
const sharp=require('sharp');

(async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'one-repair-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'source.png');
 await mkdir(output,{recursive:true});
 const cached=process.env.ONE_REPAIR_CACHED_MODEL;
 if(cached){await mkdir(path.join(profile,'models'),{recursive:true});await copyFile(cached,path.join(profile,'models','migan-pipeline-v2-6f1f3530a1a2.onnx'));}
 const pixels=Buffer.alloc(320*240*4);
 for(let y=0;y<240;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4;pixels[i]=x%256;pixels[i+1]=y%256;pixels[i+2]=90;pixels[i+3]=x<10?0:255;}
 await sharp(pixels,{raw:{width:320,height:240,channels:4}}).png().toFile(source);
 const original=await readFile(source);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 let appExit;app.process().on('exit',(code,signal)=>{appExit={code,signal};});
 try{
  await app.evaluate(({dialog},chosen)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]});},source);
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="images"]').click();await page.locator('#tool-tab-image-repair').click();
  await expect(page.locator('#page-image-repair')).toBeVisible();
  await expect(page.locator('#image-repair-model')).toContainText(cached?'已缓存':'首次使用');
  await page.locator('#image-repair-directory').evaluate((input,value)=>{input.value=value;},output);
  await page.locator('#image-repair-pick').click();await expect(page.locator('#image-repair-stage')).toBeVisible();
  const box=await page.locator('#image-repair-canvas').boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width*.47,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.49,box.y+box.height*.8,{steps:12});await page.mouse.up();
  await expect(page.locator('#image-repair-start')).toBeEnabled();
  await page.locator('#image-repair-undo').click();await expect(page.locator('#image-repair-start')).toBeDisabled();
  await page.mouse.move(box.x+box.width*.47,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.49,box.y+box.height*.8,{steps:12});await page.mouse.up();
  await page.locator('#image-repair-start').click();await expect(page.locator('#image-repair-status')).toContainText('局部修复完成',{timeout:120000});
  await expect(page.locator('#image-repair-result')).toHaveAttribute('src',/^data:image\/png;base64,/);
  const files=(await readdir(output)).filter(name=>name.endsWith('.png'));assert.equal(files.length,1);
  const saved=await sharp(path.join(output,files[0])).metadata();assert.equal(saved.width,320);assert.equal(saved.height,240);
  await page.locator('#image-repair-remove').click();await expect(page.locator('#image-repair-remove')).toHaveAttribute('aria-pressed','true');
  assert.equal(await page.locator('#image-repair-brush').getAttribute('max'),'192');
  await page.locator('#image-repair-clear').click();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.6,{steps:12});await page.mouse.up();
  await page.locator('#image-repair-start').click();await expect(page.locator('#image-repair-status')).toContainText('物体移除完成',{timeout:120000});
  const removalFiles=(await readdir(output)).filter(name=>name.includes('-object-removed-')&&name.endsWith('.png'));assert.equal(removalFiles.length,1);
  assert.deepEqual(await readFile(source),original);
  assert.equal((await stat(path.join(profile,'models','migan-pipeline-v2-6f1f3530a1a2.onnx'))).size,28079181);
  const cancelled=await page.evaluate(({source,output})=>new Promise(resolve=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(140,30,12,180);
   let requested=false;const off=window.one.onImageRepairProgress(progress=>{if(progress.phase==='process'&&progress.message==='正在本地填补选区'&&!requested){requested=true;void window.one.imageAiCancel();}});
   void window.one.imageRepairStart(source,output,canvas.toDataURL('image/png')).then(()=>{off();resolve(false);},()=>{off();resolve(true);});
  }),{source,output});
  assert.equal(cancelled,true);assert.equal((await readdir(output)).filter(name=>name.endsWith('.png')).length,2);
  await page.setViewportSize({width:700,height:850});
  const overflow=await page.locator('#page-image-repair').evaluate(element=>({scroll:element.scrollWidth,client:element.clientWidth}));assert.ok(overflow.scroll<=overflow.client+1,JSON.stringify(overflow));
  assert.deepEqual(errors,[]);
  console.log(`image-repair-ui: ${cached?'cached model':'first download'}, damage/removal mode, brush/undo, result preview and mid-inference cancel passed`);
 }catch(error){console.error('repair-ui-state',JSON.stringify({appExit}));throw error;}
 finally{await app.close();await rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
