const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('QR tab previews, copies and exports a code readable by barcode recognition',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-developer-qr-')),profile=join(root,'profile'),output=join(root,'code.png'),payload='https://example.com/one?text=中文';
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  await app.evaluate(async({clipboard})=>{globalThis.oneSavedQrClipboard=await clipboard.read();});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-developer-qr').click();
  await page.locator('#developer-qr-text').fill(payload);await expect(page.locator('#developer-qr-image')).toHaveAttribute('src',/^data:image\/png;base64,/);await expect(page.locator('#developer-qr-copy')).toBeEnabled();
  await page.locator('#developer-qr-copy').click();await expect.poll(()=>app.evaluate(async({clipboard})=>{const items=await clipboard.read();const item=items.find(value=>value.types.includes('image/png'));return item?(await item.getType('image/png')).size:0;})).toBeGreaterThan(0);
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await page.locator('#developer-qr-export').click();await expect(page.locator('#developer-qr-status')).toContainText('已导出 code.png');const png=await readFile(output);assert(png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));
  await app.evaluate(({BrowserWindow},path)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=main')).webContents.send('one:navigate-page',{page:'barcode',path}),output);
  await expect(page.locator('#barcode-content')).toHaveValue(payload,{timeout:20000});assert.deepEqual(errors,[]);
 }finally{await app.evaluate(async({clipboard})=>{const items=globalThis.oneSavedQrClipboard;if(items?.length)await clipboard.write(items);else clipboard.clear();}).catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});}
});
