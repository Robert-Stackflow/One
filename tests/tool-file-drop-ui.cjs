const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const path=require('node:path');
const sharp=require('sharp');
const {_electron:electron,expect}=require('@playwright/test');

test('developer and image file tools share the file-occupation drop overlay',async()=>{
 const root=await mkdtemp(path.resolve('work/current/tool-file-drop-')),source=path.join(root,'sample.png');
 await sharp({create:{width:24,height:20,channels:4,background:'#d75050'}}).png().toFile(source);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_SEARCH_BACKEND:'memory',ONE_DATA_DIR:path.join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='test-drag-file';document.body.append(input);});
  await page.locator('#test-drag-file').setInputFiles(source);
  assert.equal(await page.evaluate(()=>window.one.droppedFile(document.querySelector('#test-drag-file').files[0])),source);
  const drop=async(module,tab)=>{
   await page.locator(`[data-page="${module}"]`).click();await page.locator(`#tool-tab-${tab}`).click();
   const label=await page.evaluate(id=>{const target=document.getElementById('page-'+id),file=document.querySelector('#test-drag-file').files[0],transfer=new DataTransfer();transfer.items.add(file);target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:transfer}));return document.querySelector('.file-drop-overlay.visible')?.textContent||'';},tab);
   assert(label.includes('松开'),`${tab}: overlay missing`);
   await page.evaluate(id=>{const target=document.getElementById('page-'+id),file=document.querySelector('#test-drag-file').files[0],transfer=new DataTransfer();transfer.items.add(file);target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));},tab);
  };
  await drop('developer','base64');await expect(page.locator('#base64-file-name')).toHaveText('sample.png');await expect(page.locator('#base64-output')).not.toHaveValue('');
  await drop('developer','developer-hash');await expect(page.locator('#developer-hash-digest')).toHaveText(/^[0-9a-f]{64}$/);
  for(const [tab,count] of [['image-convert','#image-convert-count'],['image-crop','#image-crop-count'],['image-resize','#image-resize-count'],['image-metadata','#image-metadata-count']]){await drop('images',tab);await expect(page.locator(count)).toContainText('1 张');}
  await drop('images','image-color');await expect(page.locator('#image-color-name')).toHaveText('sample.png');
  for(const [tab,label] of [['image-ai','#image-ai-source'],['image-superres','#image-superres-source'],['image-repair','#image-repair-source']]){await drop('images',tab);await expect(page.locator(label)).toContainText('sample.png');}
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
