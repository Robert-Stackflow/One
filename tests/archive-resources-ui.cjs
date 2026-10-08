const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-resources-ui-'));let app;
 try{
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({shell,ipcMain})=>{globalThis.archiveRequests=[];globalThis.explorerCalls=0;shell.showItemInFolder=()=>globalThis.explorerCalls++;shell.openPath=async()=>{globalThis.explorerCalls++;return '';};const run=ipcMain._invokeHandlers.get('one:archive-run');ipcMain.removeHandler('one:archive-run');ipcMain.handle('one:archive-run',(event,request,id)=>{globalThis.archiveRequests.push(request);return run(event,request,id);});});
  await page.locator('[data-page="settings"]').click();await page.locator('[data-settings-tab="archive"]').click();await expect(page.locator('#archive-pref-memory')).toHaveValue('1024');
  await page.locator('#archive-pref-level').evaluate(node=>{node.value='0';node.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#archive-pref-threads').fill('1');await page.locator('#archive-pref-threads').press('Tab');await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).archive.threads)).toBe(1);
  await page.locator('#archive-pref-memory').fill('192');await page.locator('#archive-pref-memory').press('Tab');await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).archive.memoryMiB)).toBe(192);
  await page.locator('[data-page="archive"]').click();await expect(page.locator('#archive-threads')).toHaveValue('1');await expect(page.locator('#archive-memory')).toHaveValue('192');
  assert.equal(await page.locator('#archive-level').evaluate(node=>node.value),'0');assert.equal(await page.locator('.archive-advanced').evaluate(node=>node.open),false);
  await page.locator('.archive-advanced summary').click();await page.locator('#archive-level').evaluate(node=>{node.value='9';node.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#archive-threads').fill('2');await page.locator('#archive-memory').fill('256');
  const source=path.join(root,'input.txt'),target=path.join(root,'created.zip');await fs.writeFile(source,'resource UI\n'.repeat(50000));await page.locator('#archive-sources').fill(source);await page.locator('#archive-target').fill(target);await page.locator('#archive-create').click();await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包');
  const request=(await app.evaluate(()=>globalThis.archiveRequests)).find(value=>value.operation==='create');assert.equal(request.level,9);assert.equal(request.threads,2);assert.equal(request.memoryMiB,256);
  assert.equal((await page.evaluate(()=>window.one.settings())).archive.compressionLevel,0,'Task override must not change saved defaults');
  await page.reload();await page.locator('[data-page="archive"]').click();await expect(page.locator('#archive-memory')).toHaveValue('192');assert.equal(await page.locator('#archive-level').evaluate(node=>node.value),'0');
  assert.equal(await app.evaluate(()=>globalThis.explorerCalls),0);assert.deepEqual(errors,[]);
  console.log('Archive resources UI passed: saved defaults, per-task override, real creation, reload persistence and no Explorer calls.');
 }finally{if(app)await app.close();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
