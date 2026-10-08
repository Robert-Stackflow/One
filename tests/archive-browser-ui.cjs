const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-browser-ui-'));let app;
 try{
  const source=new JSZip();source.file('隐含目录/deep/data.txt','nested',{createFolders:false});source.file('隐含目录/other.txt','other',{createFolders:false});
  for(let i=0;i<405;i++)source.file(`root-${String(i).padStart(3,'0')}.txt`,'content '+i);
  const zip=path.join(root,'browser.zip');await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer'}));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({shell,ipcMain})=>{
   globalThis.archiveReveals=0;globalThis.dragRequests=[];shell.showItemInFolder=()=>globalThis.archiveReveals++;shell.openPath=async()=>{globalThis.archiveReveals++;return '';};
   const previous=ipcMain._invokeHandlers.get('one:archive-run');ipcMain.removeHandler('one:archive-run');
   ipcMain.handle('one:archive-run',(event,request,id)=>{if(request.operation!=='drag')return previous(event,request,id);globalThis.dragRequests.push(request);return {path:request.path,count:request.selected.length+request.selectedFolders.length,cancelled:true};});
  });
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await expect(page.locator('#archive-open-completed')).not.toBeChecked();
  const content=path.join(root,'created.txt'),created=path.join(root,'created.zip');await fs.writeFile(content,'create test');
  await page.locator('#archive-sources').fill(content);await page.locator('#archive-target').fill(created);await page.locator('#archive-create').click();await expect(page.locator('#archive-status-text')).toContainText('已创建压缩包');
  await page.locator('[data-archive-mode="browse"]').click();await page.locator('#archive-source').fill(zip);await page.locator('#archive-open').click();await expect(page.locator('.archive-entry')).toHaveCount(200);
  const row=name=>page.locator('.archive-entry').filter({has:page.locator('.archive-entry-name',{hasText:name})});
  await row('隐含目录').locator('input').check();await row('root-000').locator('input').check();
  await page.locator('#archive-more').click();await expect(page.locator('.archive-entry')).toHaveCount(200);await row('root-200').locator('input').check();await expect(page.locator('#archive-browser-summary')).toContainText('已选择 3 项');
  await page.locator('#archive-search').fill('ROOT-404');await page.locator('#archive-search-run').click();await expect(page.locator('.archive-entry-name')).toHaveText(['root-404.txt']);await row('root-404').locator('input').check();await expect(page.locator('#archive-browser-summary')).toContainText('已选择 4 项');
  await page.locator('#archive-parent').fill(root);await page.locator('#archive-extract-selected').click();await expect(page.locator('#archive-status-text')).toContainText('已解压');
  const extracted=path.join(root,'browser');assert.equal(await fs.readFile(path.join(extracted,'隐含目录/deep/data.txt'),'utf8'),'nested');assert.equal(await fs.readFile(path.join(extracted,'root-200.txt'),'utf8'),'content 200');assert.deepEqual((await fs.readdir(extracted)).sort(),['root-000.txt','root-200.txt','root-404.txt','隐含目录'].sort());
  await row('root-404').locator('.archive-entry-name').evaluate(element=>element.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true})));await expect(page.locator('#archive-status-text')).toHaveText('已取消拖出');
  const request=(await app.evaluate(()=>globalThis.dragRequests))[0];assert.equal(request.selected.length,3);assert.deepEqual(request.selectedFolders,['隐含目录/']);
  await page.locator('#archive-breadcrumb [data-archive-directory=""]').click();await expect(page.locator('.archive-entry')).toHaveCount(200);await expect(row('root-000').locator('input')).toBeChecked();
  await page.locator('#archive-selection-clear').click();await row('隐含目录').locator('button').click();await expect(page.locator('.archive-entry-name')).toHaveText(['deep','other.txt']);
  await page.locator('#archive-search').fill('data');await page.locator('#archive-search').press('Enter');await expect(page.locator('.archive-entry-name')).toHaveText(['隐含目录/deep/data.txt']);
  await page.locator('#archive-breadcrumb [data-archive-directory="隐含目录/"]').click();await expect(page.locator('.archive-entry')).toHaveCount(2);await row('deep').locator('button').click();await expect(page.locator('.archive-entry-name')).toHaveText(['data.txt']);await row('data.txt').locator('input').check();
  await page.locator('[data-archive-edit="rename"]').click();let dialog=page.locator('dialog[open]');await dialog.locator('[data-edit-name]').fill('隐含目录/deep/renamed.txt');await dialog.locator('[data-edit-queue]').click();await expect(page.locator('#archive-edit-changes li')).toHaveCount(1);
  await page.locator('#archive-breadcrumb [data-archive-directory=""]').click();await expect(page.locator('.archive-entry')).toHaveCount(200);await expect(page.locator('#archive-edit-changes li')).toHaveCount(1);
  await page.locator('#archive-edit-save').click();dialog=page.locator('dialog[open]');await dialog.locator('[data-dialog-confirm]').click();await expect(page.locator('#archive-status-text')).toHaveText('已保存压缩包修改',{timeout:30000});
  assert.equal(await (await JSZip.loadAsync(await fs.readFile(zip))).file('隐含目录/deep/renamed.txt').async('string'),'nested');
  await fs.appendFile(zip,'changed');await row('隐含目录').locator('button').click();await expect(page.locator('#archive-status-text')).toHaveText('压缩包已经变化，请重新打开');await expect(page.locator('#archive-browser')).toBeHidden();
  await page.locator('#archive-open-completed').check();await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).archive.openCompleted)).toBe(true);
  await page.locator('#archive-open-completed').uncheck();await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).archive.openCompleted)).toBe(false);
  await page.reload();await page.locator('[data-page="archive"]').click();await expect(page.locator('#archive-open-completed')).not.toBeChecked();
  assert.equal(await app.evaluate(()=>globalThis.archiveReveals),0);assert.deepEqual(errors,[]);
  console.log('Archive browser UI passed: bounded paging, recursive search, breadcrumbs, cross-page selection/extraction/drag, editing across navigation and saved no-open-folder preference. Explorer calls were mocked.');
 }finally{if(app)await app.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
