const {fillArchiveSources}=require('./archive-ui-helpers.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-task-ui-'));let app;
 try{
  const profile=path.join(root,'profile'),input=path.join(root,'input.txt');await fs.writeFile(input,'background archive task');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({shell})=>{
   globalThis.archiveExplorerCalls=0;shell.showItemInFolder=()=>globalThis.archiveExplorerCalls++;shell.openPath=async()=>{globalThis.archiveExplorerCalls++;return '';};
   // Hold only the next archive helper's password frame. This leaves a real
   // native process and service job alive while exercising home/tray actions.
   const childProcess=process.getBuiltinModule('node:child_process'),spawn=childProcess.spawn;
   childProcess.spawn=function(file,args,...rest){const child=spawn.call(this,file,args,...rest);
    if(globalThis.holdNextArchive&&String(file).endsWith('One.Archive.exe')&&args[0]===(globalThis.holdArchiveOperation||'create')){
     globalThis.holdNextArchive=false;const end=child.stdin.end.bind(child.stdin);child.stdin.end=(...input)=>{globalThis.releaseArchive=()=>{globalThis.releaseArchive=undefined;end(...input);};return child.stdin;};
    }return child;
   };
  });
  const create=async target=>{await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="create"]').click();await fillArchiveSources(page,input);await page.locator('#archive-target').fill(target);await app.evaluate(()=>{globalThis.holdNextArchive=true;});await page.locator('#archive-create').click();await expect.poll(()=>app.evaluate(()=>typeof globalThis.releaseArchive)).toBe('function');};
  await create(path.join(root,'cancelled.zip'));await page.locator('[data-page="home"]').click();await expect(page.locator('#overview-active')).toContainText('创建压缩包');
  const stop=page.locator('[data-overview-cancel][data-overview-archive]');await expect(stop).toBeEnabled();await stop.click();
  await expect(page.locator('#overview-active')).not.toContainText('创建压缩包');await expect(page.locator('#overview-history')).toContainText('已取消');await assert.rejects(fs.stat(path.join(root,'cancelled.zip')),{code:'ENOENT'});
  const output=path.join(root,'completed.zip');await create(output);await page.locator('[data-page="home"]').click();await expect(page.locator('#overview-active')).toContainText('创建压缩包');
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main'));window.hide();globalThis.releaseArchive();});
  await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(profile,'tasks/archive.json'),'utf8')).tasks.find(task=>task.path===output)?.state,{timeout:30000}).toBe('completed');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).showInactive());
  await expect(page.locator('#overview-history')).toContainText('completed.zip');await expect(page.locator('#overview-history')).toContainText('已完成');
  assert.equal(await app.evaluate(()=>globalThis.archiveExplorerCalls),0,'background completion must not open Explorer');
  const completed=page.locator('[data-overview-report]').filter({hasText:'completed.zip'});await completed.click();const detail=page.locator('#archive-task-detail');await expect(detail).toBeVisible();
  await expect(detail).toContainText('处理内容');await expect(detail).toContainText(output);await detail.locator('[data-task-reveal]').click();await expect.poll(()=>app.evaluate(()=>globalThis.archiveExplorerCalls)).toBe(1);
  await detail.locator('[data-task-browse]').click();await expect(page.locator('[data-page="archive"]')).toHaveClass(/active/);await expect(page.locator('.archive-entry-name')).toHaveText('input.txt');
  assert.equal((await page.evaluate(()=>window.one.fileToolsOverview())).archive.recent.length,2,'history browsing does not add another task');
  const taskResult=await page.evaluate(async file=>{await window.one.archiveRun({operation:'test',path:file});return window.one.fileToolsOverview();},output);assert.equal(taskResult.archive.recent[0].operation,'test');assert.equal(taskResult.archive.recent[0].state,'completed');
  const batchFiles=[];for(let i=1;i<=2;i++){const zip=new JSZip();zip.file('batch-content-'+i+'.txt','batch content');const file=path.join(root,'batch-'+i+'.zip');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));batchFiles.push(file);}
  await app.evaluate(({BrowserWindow},paths)=>{globalThis.holdNextArchive=true;globalThis.holdArchiveOperation='extract';BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).webContents.send('one:navigate-page',{page:'archive',action:'smart',paths});},batchFiles);
  await expect.poll(()=>app.evaluate(()=>typeof globalThis.releaseArchive)).toBe('function');await page.locator('[data-page="home"]').click();await expect(page.locator('#overview-active')).toContainText('解压压缩包');await page.locator('[data-overview-cancel][data-overview-archive]').click();
  await expect(page.locator('#overview-active')).not.toContainText('解压压缩包');await page.locator('[data-page="archive"]').click();await expect(page.locator('#archive-status-text')).toContainText('已停止批量解压');await expect(page.locator('[data-batch-state="已取消"]')).toHaveCount(2);for(let i=1;i<=2;i++)await assert.rejects(fs.stat(path.join(root,'batch-content-'+i+'.txt')),{code:'ENOENT'});
  await page.reload();await expect(page.locator('#overview-history')).toContainText('校验压缩包');assert.equal(await app.evaluate(()=>globalThis.archiveExplorerCalls),1);
  const duplicates=path.join(root,'duplicates');await fs.mkdir(duplicates);await fs.writeFile(path.join(duplicates,'a.txt'),'same file');await fs.writeFile(path.join(duplicates,'b.txt'),'same file');
  await page.evaluate(dir=>window.one.fileToolsRun({kind:'duplicates',roots:[dir],recursive:true,minBytes:0,extensions:''}),duplicates);await page.locator('#overview-refresh').click();
  await expect(page.locator('#overview-history')).toContainText('重复文件');await expect(page.locator('#overview-history')).toContainText('创建压缩包');await page.locator('[data-overview-report]').filter({hasText:'重复文件'}).click();await expect(page.locator('#page-name')).toHaveText('文件工具');await expect(page.locator('#tool-result-title')).toContainText('1 组');
  assert.deepEqual(errors,[]);await app.close();app=undefined;
  app=await electron.launch({args:[path.resolve('.')],env});const restored=await app.firstWindow();
  await app.evaluate(({shell})=>{globalThis.archiveExplorerCalls=0;shell.showItemInFolder=()=>globalThis.archiveExplorerCalls++;shell.openPath=async()=>{globalThis.archiveExplorerCalls++;return '';};});
  await expect(restored.locator('#overview-history')).toContainText('校验压缩包');await expect(restored.locator('#overview-history')).toContainText('已取消');assert.equal(await app.evaluate(()=>globalThis.archiveExplorerCalls),0);
  console.log('Archive task UI passed: actual native jobs, home cancellation, hidden-window completion, saved history, detail/browse routes and explicit-only mocked Explorer reveal.');
 }finally{if(app)await app.close();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
