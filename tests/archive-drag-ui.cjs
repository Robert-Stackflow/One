const {openArchiveOptions,closeArchiveOptions,setArchivePassword,testArchive}=require('./archive-ui-helpers.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-drag-ui-'));let app;
 try{
  const source=new JSZip();for(let i=0;i<202;i++)source.file(`item-${String(i).padStart(3,'0')}.txt`,`contents ${i}`);
  const zip=path.join(root,'drag-ui.zip');await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer'}));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({shell,ipcMain,BrowserWindow})=>{
   globalThis.archiveReveals=0;globalThis.dragRequests=[];shell.showItemInFolder=()=>globalThis.archiveReveals++;shell.openPath=async()=>{globalThis.archiveReveals++;return '';};
   const previous=ipcMain._invokeHandlers.get('one:archive-run');ipcMain.removeHandler('one:archive-run');
   ipcMain.handle('one:archive-run',async(event,request,id)=>{
    if(request.operation!=='drag')return previous(event,request,id);
    globalThis.dragRequests.push({...request,id});
    const target=BrowserWindow.fromWebContents(event.sender);target.webContents.send('one:archive-progress',{id,operation:'drag',done:0,total:0});
    await new Promise(resolve=>globalThis.finishArchiveDrag=resolve);
    return {path:request.path,count:request.selected.length,cancelled:globalThis.cancelArchiveDrag===true};
   });
  });
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  await page.locator('#archive-source').fill(zip);await setArchivePassword(page,' 密 码 ');await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(200);
  await page.locator('.archive-entry input').nth(0).check();await page.locator('#archive-more').click();await expect(page.locator('.archive-entry')).toHaveCount(2);
  await page.locator('.archive-entry input').nth(1).check();
  const start=index=>page.locator('.archive-entry-name').nth(index).evaluate(element=>{
   const event=new DragEvent('dragstart',{bubbles:true,cancelable:true});element.dispatchEvent(event);return event.defaultPrevented;
  });
  assert.equal(await start(1),true);await expect(page.locator('#archive-status-text')).toContainText('按 Esc 取消');await expect(page.locator('#archive-cancel')).toBeHidden();
  let requests=await app.evaluate(()=>globalThis.dragRequests);assert.deepEqual(requests[0].selected,[0,201]);assert.equal(requests[0].path,zip);assert.equal(requests[0].password,' 密 码 ');assert.match(requests[0].revision,/^\d+(?::\d+){6}$/);
  await start(1);assert.equal(await app.evaluate(()=>globalThis.dragRequests.length),1,'do not launch another drag while transferring');
  await app.evaluate(()=>globalThis.finishArchiveDrag());await expect(page.locator('#archive-status-text')).toHaveText('拖出操作已完成');
  await start(0);await expect(page.locator('#archive-status-text')).toContainText('按 Esc 取消');requests=await app.evaluate(()=>globalThis.dragRequests);assert.deepEqual(requests[1].selected,[200]);
  await expect(page.locator('.archive-entry input:checked')).toHaveCount(1);await app.evaluate(()=>{globalThis.cancelArchiveDrag=true;globalThis.finishArchiveDrag();});await expect(page.locator('#archive-status-text')).toHaveText('已取消拖出');
  await page.locator('[data-archive-edit="rename"]').click();const dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-name]').fill('renamed.txt');await dialog.locator('[data-edit-queue]').click();
  await expect(page.locator('#archive-edit-changes li')).toHaveCount(1);await start(1);await expect(page.locator('#archive-status-text')).toContainText('请先保存或放弃');assert.equal(await app.evaluate(()=>globalThis.dragRequests.length),2);
  assert.equal(await app.evaluate(()=>globalThis.archiveReveals),0);assert.deepEqual(errors,[]);
  console.log('Archive drag UI passed: cross-page multiselect, single selection, native routing/revision, busy guard, cancellation, pending-edit guard and zero Explorer windows.');
 }finally{if(app)await app.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
