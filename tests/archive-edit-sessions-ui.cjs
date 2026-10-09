const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const JSZip=require('jszip'),{spawnSync}=require('node:child_process'),{_electron:electron,expect}=require('@playwright/test');
const {openArchiveEditor}=require('./archive-ui-helpers.cjs');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-edit-sessions-ui-'));let app;
 try{
  const zip=new JSZip();zip.file('说明.txt','original');zip.file('folder/other.txt','other');const archive=path.join(root,'edit.zip');await fs.writeFile(archive,await zip.generateAsync({type:'nodebuffer'}));const before=await fs.readFile(archive);
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({shell})=>{globalThis.editOpened=[];shell.openPath=async file=>{globalThis.editOpened.push(file);return '';};shell.showItemInFolder=()=>{};});
  await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();await page.locator('#archive-source').fill(archive);await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(2);
  await openArchiveEditor(page);await expect(page.locator('[data-archive-edit="external"]')).toBeDisabled();
  const select=name=>page.locator('.archive-entry').filter({has:page.locator('.archive-entry-name',{hasText:name})}).locator('input');
  await select('folder').check();await expect(page.locator('[data-archive-edit="external"]')).toBeDisabled();await select('folder').uncheck();await select('说明.txt').check();await expect(page.locator('[data-archive-edit="external"]')).toBeEnabled();
  await openArchiveEditor(page);await page.locator('[data-archive-edit="external"]').click();const manager=page.locator('#archive-edit-sessions');await expect(manager).toBeVisible();await expect(manager.locator('.archive-recovery-item')).toHaveCount(1);
  await expect(manager.locator('[data-edit-save]')).toBeDisabled();await manager.locator('[data-edit-check]').click();await expect(manager.locator('[data-edit-state]')).toHaveText('文件内容没有变化');
  await manager.locator('[data-edit-open]').click();await expect(manager.locator('[data-edit-feedback]')).toContainText('已打开临时文件');const opened=await app.evaluate(()=>globalThis.editOpened);assert.equal(opened.length,1);assert.equal(await fs.readFile(opened[0],'utf8'),'original');
  await fs.writeFile(opened[0],'用户修改');assert.deepEqual(await fs.readFile(archive),before);await manager.locator('[data-edit-check]').click();await expect(manager.locator('[data-edit-save]')).toBeEnabled();
  await manager.locator('[data-edit-save]').click();await expect(page.locator('dialog[open]').last()).toContainText('写回压缩包');await page.locator('dialog[open]').last().locator('[data-dialog-cancel]').click();assert.deepEqual(await fs.readFile(archive),before);
  await manager.locator('[data-edit-save]').click();await page.locator('dialog[open]').last().locator('[data-dialog-confirm]').click();await expect(manager.locator('[data-edit-feedback]')).toHaveText('已写回；编辑副本已保留。',{timeout:30000});await expect(manager.locator('[data-edit-save]')).toBeDisabled();assert.equal(await (await JSZip.loadAsync(await fs.readFile(archive))).file('说明.txt').async('string'),'用户修改');
  await manager.locator('[data-dialog-dismiss]').last().click();await expect(manager).toHaveCount(0);
  await page.reload();await page.locator('[data-page="archive"]').click();await page.locator('#archive-edit-sessions-open').click();await expect(manager.locator('.archive-recovery-item')).toHaveCount(1);await expect(manager.locator('[data-edit-state]')).toContainText('已写回');
  await fs.writeFile(opened[0],'写回后的新修改');await manager.locator('[data-edit-remove]').click();await expect(page.locator('dialog[open]').last()).toContainText('尚未写回的修改');await page.locator('dialog[open]').last().locator('[data-dialog-cancel]').click();assert.equal(await fs.readFile(opened[0],'utf8'),'写回后的新修改');
  await manager.locator('[data-edit-remove]').click();await page.locator('dialog[open]').last().locator('[data-dialog-confirm]').click();await expect(manager.locator('.archive-recovery-item')).toHaveCount(0);await assert.rejects(fs.stat(opened[0]),{code:'ENOENT'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',scope:'selection gating, extraction, launch association, changed detection, cancelled/confirmed writeback, retained copy after reload, explicit discard warning and cleanup; OS application launch mocked'}));
 }finally{await app?.close();assert.ok(root.startsWith(path.resolve('work/temp')+path.sep));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
