const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
const {spawnSync}=require('node:child_process');
const {_electron:electron,expect}=require('@playwright/test');
async function verify(format){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-edit-ui-'));
 let app;
 try{
  const source=new JSZip();source.file('source.txt','contents');source.file('delete.txt','removed');source.comment='before';
  const zip=path.join(root,'edit-ui.'+format);
  const native=(args)=>{const result=spawnSync(path.resolve('dist/native/One.Archive.exe'),args,{input:Buffer.alloc(4),encoding:'utf8',windowsHide:true,env:{...process.env,TEMP:root,TMP:root}});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
  if(format==='zip')await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer'}));
  else{const first=path.join(root,'source.txt'),second=path.join(root,'delete.txt');await fs.writeFile(first,'contents');await fs.writeFile(second,'removed');native(['create',zip,first,second]);}
  const original=await fs.readFile(zip);
  const added=path.join(root,'added.txt');await fs.writeFile(added,'new contents');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  // Exercise explicit opt-in without ever opening a real Explorer window.
  await app.evaluate(({shell,ipcMain},selected)=>{globalThis.archiveRevealCount=0;shell.showItemInFolder=()=>globalThis.archiveRevealCount++;shell.openPath=async()=>{globalThis.archiveRevealCount++;return '';};ipcMain.removeHandler('one:pick-file');ipcMain.handle('one:pick-file',()=>selected);},added);
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  await page.locator('#archive-source').fill(zip);await page.locator('#archive-open').click();await expect(page.locator('.archive-entry-name')).toHaveCount(2);
  await expect(page.locator('#archive-editor')).toBeVisible();
  const select=name=>page.locator('.archive-entry').filter({has:page.locator('.archive-entry-name',{hasText:name})}).locator('input');
  await select('source.txt').check();await page.locator('[data-archive-edit="rename"]').click();
  let dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-name]').fill('renamed.txt');await dialog.locator('[data-edit-queue]').click();await expect(dialog).toHaveCount(0);
  await page.locator('[data-archive-edit="mkdir"]').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-name]').fill('empty');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('[data-archive-edit="add"]').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-pick-file]').click();await expect(dialog.locator('[data-edit-source]')).toHaveValue(added);await dialog.locator('[data-edit-name]').fill('added/new.txt');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await select('source.txt').uncheck();await select('delete.txt').check();await page.locator('[data-archive-edit="delete"]').click();
  if(format==='zip'){await page.locator('[data-archive-edit="comment"]').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-comment]').fill('修改后的备注');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);}
  else await expect(page.locator('[data-archive-edit="comment"]')).toBeHidden();
  const count=format==='zip'?5:4;
  await expect(page.locator('#archive-edit-changes li')).toHaveCount(count);assert.deepEqual(await fs.readFile(zip),original,'queued changes must not write the original');
  await page.locator('#archive-open').click();dialog=page.locator('dialog[open]');await expect(dialog).toContainText('放弃未保存的修改');await dialog.locator('[data-dialog-cancel]').click();await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('#archive-edit-changes li')).toHaveCount(count);
  await page.locator('#archive-edit-save').click();dialog=page.locator('dialog[open]');await expect(dialog).toContainText('renamed.txt');await expect(dialog).toContainText('添加：added/new.txt');await dialog.locator('[data-dialog-confirm]').click();
  await expect(page.locator('#archive-status-text')).toHaveText('已保存压缩包修改',{timeout:30000});await expect(page.locator('#archive-edit-preview')).toBeHidden();
  await expect(page.locator('.archive-entry-name')).toHaveText(['added','empty','renamed.txt']);await page.locator('#archive-flat').check();await expect(page.locator('.archive-entry-name')).toHaveText([format==='zip'?'empty/':'empty','added/new.txt','renamed.txt']);
  if(format==='zip'){await expect(page.locator('#archive-comment')).toContainText('修改后的备注');const result=await JSZip.loadAsync(await fs.readFile(zip));assert.equal(await result.file('renamed.txt').async('string'),'contents');assert.equal(await result.file('added/new.txt').async('string'),'new contents');assert.equal(result.file('delete.txt'),null);}
  else{const output=path.join(root,'extracted');native(['extract',zip,output,'','0']);assert.equal(await fs.readFile(path.join(output,'renamed.txt'),'utf8'),'contents');assert.equal(await fs.readFile(path.join(output,'added/new.txt'),'utf8'),'new contents');await assert.rejects(fs.stat(path.join(output,'delete.txt')),{code:'ENOENT'});}
  assert.equal(await app.evaluate(()=>globalThis.archiveRevealCount),0,'editing must not open Explorer');assert.deepEqual(errors,[]);
  console.log(format.toUpperCase()+' edit UI passed: queue, preview, discard, rename/delete/add/mkdir, format-specific comments, refresh and no Explorer windows.');
 }finally{if(app)await app.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
async function main(){for(const format of ['zip','7z'])await verify(format);}
main().catch(error=>{console.error(error);process.exitCode=1;});
