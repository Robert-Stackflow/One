const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-edit-ui-'));
 let app;
 try{
  const source=new JSZip();source.file('source.txt','contents');source.file('delete.txt','removed');source.comment='before';
  const zip=path.join(root,'edit-ui.zip');await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer'}));const original=await fs.readFile(zip);
  const added=path.join(root,'added.txt');await fs.writeFile(added,'new contents');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  // Exercise explicit opt-in without ever opening a real Explorer window.
  await app.evaluate(({shell,ipcMain},selected)=>{globalThis.archiveRevealCount=0;shell.showItemInFolder=()=>globalThis.archiveRevealCount++;ipcMain.removeHandler('one:pick-file');ipcMain.handle('one:pick-file',()=>selected);},added);
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  await page.locator('#archive-source').fill(zip);await page.locator('#archive-open').click();await expect(page.locator('.archive-entry-name')).toHaveCount(2);
  await expect(page.locator('#archive-editor')).toBeVisible();
  const select=name=>page.locator('.archive-entry').filter({has:page.locator('.archive-entry-name',{hasText:name})}).locator('input');
  await select('source.txt').check();await page.locator('[data-archive-edit="rename"]').click();
  let dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-name]').fill('renamed.txt');await dialog.locator('[data-edit-queue]').click();await expect(dialog).toHaveCount(0);
  await page.locator('[data-archive-edit="mkdir"]').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-name]').fill('empty');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('[data-archive-edit="add"]').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-pick-file]').click();await expect(dialog.locator('[data-edit-source]')).toHaveValue(added);await dialog.locator('[data-edit-name]').fill('added/new.txt');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await select('source.txt').uncheck();await select('delete.txt').check();await page.locator('[data-archive-edit="delete"]').click();
  await page.locator('[data-archive-edit="comment"]').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-comment]').fill('修改后的备注');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#archive-edit-changes li')).toHaveCount(5);assert.deepEqual(await fs.readFile(zip),original,'queued changes must not write the original');
  await page.locator('#archive-open').click();dialog=page.locator('dialog[open]');await expect(dialog).toContainText('放弃未保存的修改');await dialog.locator('[data-dialog-cancel]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('#archive-edit-changes li')).toHaveCount(5);
  await page.locator('#archive-edit-save').click();dialog=page.locator('dialog[open]');await expect(dialog).toContainText('renamed.txt');await expect(dialog).toContainText('添加：added/new.txt');await dialog.locator('[data-dialog-confirm]').click();
  await expect(page.locator('#archive-status-text')).toHaveText('已保存压缩包修改',{timeout:30000});await expect(page.locator('#archive-edit-preview')).toBeHidden();
  await expect(page.locator('.archive-entry-name')).toHaveText(['renamed.txt','empty/','added/new.txt']);await expect(page.locator('#archive-comment')).toContainText('修改后的备注');
  const result=await JSZip.loadAsync(await fs.readFile(zip));assert.equal(await result.file('renamed.txt').async('string'),'contents');assert.equal(await result.file('added/new.txt').async('string'),'new contents');assert.equal(result.file('delete.txt'),null);
  assert.equal(await app.evaluate(()=>globalThis.archiveRevealCount),0,'editing must not open Explorer');assert.deepEqual(errors,[]);
  console.log('Archive edit UI passed: queue, change preview, discard confirmation, rename/delete/add/mkdir/comment, successful refresh and no Explorer windows.');
 }finally{if(app)await app.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
