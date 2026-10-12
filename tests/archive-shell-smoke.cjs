const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {_electron:electron,expect}=require('@playwright/test');

async function main(){
 const base=path.resolve('work/temp');await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'one-archive-shell-'));
 const profile=path.join(root,'profile'),inbox=path.join(profile,'shell-requests');
 const sourceDir=path.join(root,'sources'),outputDir=path.join(root,'archives');
 await fs.mkdir(inbox,{recursive:true});await fs.mkdir(sourceDir);await fs.mkdir(outputDir);
 const source=path.join(sourceDir,'sample.txt'),other=path.join(sourceDir,'second.txt');
 await fs.writeFile(source,'Archive shell request\n');await fs.writeFile(other,'Second request\n');
 const request=async(tool,paths)=>{const file=path.join(inbox,crypto.randomUUID()+'.json');await fs.writeFile(file,JSON.stringify({tool,paths}));return file;};
 const capture=async(page,name)=>{if(!process.env.ONE_CAPTURE_ARCHIVE_TASK&&!(process.env.ONE_CAPTURE_ARCHIVE_READY&&name==='compression-ready'))return;const folder=path.resolve('work/current/archive-window-shots');await fs.mkdir(folder,{recursive:true});await page.screenshot({path:path.join(folder,name+'.png')});const geometry=await page.evaluate(()=>{const main=document.querySelector('.archive-task-main');return {header:document.querySelector('.archive-task-header')?.getBoundingClientRect().toJSON(),main:main?.getBoundingClientRect().toJSON(),overflow:(main?.scrollHeight||0)-(main?.clientHeight||0)}});console.log(`capture ${name} ${JSON.stringify(geometry)}`);};
 const initial=await request('archive-create',[source,other]);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.'),`--one-shell-request=${initial}`],env});
 const task=async(count=1)=>{await expect.poll(()=>app.windows().filter(page=>/[?&]view=archive-task(?:$|&)/.test(page.url())).length,{timeout:20000}).toBe(count);const page=app.windows().filter(page=>/[?&]view=archive-task(?:$|&)/.test(page.url())).at(-1);await page.waitForSelector('#archive-task-start',{state:'attached'});return page;};
 const close=async(page)=>{await page.locator('#archive-task-cancel').click({noWaitAfter:true}).catch(error=>{if(!page.isClosed())throw error;});await expect.poll(()=>app.windows().includes(page)).toBe(false);};
 const createFixture=(target,password='')=>{const bytes=Buffer.from(password),packet=Buffer.alloc(4+bytes.length);packet.writeUInt32LE(bytes.length);bytes.copy(packet,4);const result=spawnSync(path.resolve('dist/native/One.Archive.exe'),['create',target,source],{input:packet,encoding:'utf8',windowsHide:true,env});assert.equal(result.status,0,result.stdout+result.stderr);};
 try{
  const manual=await task();await expect(manual.locator('#archive-task-path')).toHaveValue(path.join(sourceDir,'选中项.zip'));await expect(manual.locator('.archive-create-item')).toHaveCount(2);
  await manual.locator('[data-remove-source="1"]').click();await expect(manual.locator('.archive-create-item')).toHaveCount(1);
  await app.evaluate(({ipcMain},selected)=>{ipcMain.removeHandler('one:pick-file');ipcMain.handle('one:pick-file',()=>selected);},other);
  await manual.locator('#archive-task-add-file').click();await expect(manual.locator('.archive-create-item')).toHaveCount(2);
  await manual.locator('[data-remove-source="1"]').click();
  const bundle=path.join(root,'bundle');await fs.mkdir(bundle);await fs.writeFile(path.join(bundle,'nested.txt'),'folder size');
  await app.evaluate(({ipcMain},selected)=>{ipcMain.removeHandler('one:pick-directory');ipcMain.handle('one:pick-directory',()=>selected);},bundle);
  await manual.locator('#archive-task-add-folder').click();await expect(manual.locator('.archive-create-item')).toHaveCount(2);
  await expect(manual.locator('.archive-create-item-size').nth(1)).toHaveText('11 B');await expect(manual.locator('#archive-task-source-total')).toContainText('总大小 · 33 B');
  await manual.locator('[data-remove-source="1"]').click();await expect(manual.locator('#archive-task-source-total')).toHaveText('总大小 · 22 B');
  await manual.locator('#archive-task-format').click();await manual.getByRole('option',{name:'TAR.GZ'}).click();await expect(manual.locator('#archive-task-path')).toHaveValue(path.join(sourceDir,'选中项.tar.gz'));
  await manual.locator('#archive-task-format').click();await manual.getByRole('option',{name:'ZIP',exact:true}).click();
  await manual.locator('#archive-task-advanced summary').click();await manual.locator('#archive-task-volume').click();await manual.getByRole('option',{name:'自定义大小…'}).click();
  await manual.locator('#archive-task-volume-custom').fill('0');await manual.locator('#archive-task-start').click();await expect(manual.locator('#archive-task-feedback.error')).toContainText('分卷大小');
  await manual.locator('#archive-task-volume').click();await manual.getByRole('option',{name:'不分卷'}).click();await capture(manual,'compression-ready');
  const manualTarget=path.join(outputDir,'manual.zip');await manual.locator('#archive-task-path').fill(manualTarget);
  await manual.locator('#archive-task-start').click();await expect(manual.locator('#archive-task-feedback')).toContainText('已创建',{timeout:30000});
  await capture(manual,'compression-complete');await fs.stat(manualTarget);await assert.rejects(fs.stat(initial),{code:'ENOENT'});await close(manual);

  await request('archive-create',[source]);const tarTask=await task();
  await tarTask.locator('#archive-task-format').click();await tarTask.getByRole('option',{name:'TAR.GZ'}).click();
  const tarTarget=path.join(outputDir,'manual.tar.gz');await tarTask.locator('#archive-task-path').fill(tarTarget);
  await tarTask.locator('#archive-task-start').click();await expect(tarTask.locator('#archive-task-feedback')).toContainText('已创建',{timeout:30000});await fs.stat(tarTarget);await close(tarTask);

  const splitSource=path.join(sourceDir,'split.bin');await fs.writeFile(splitSource,crypto.randomBytes(3*1024*1024));
  await request('archive-create',[splitSource]);const splitTask=await task();
  await splitTask.locator('#archive-task-advanced summary').click();await splitTask.locator('#archive-task-volume').click();await splitTask.getByRole('option',{name:'自定义大小…'}).click();
  await splitTask.locator('#archive-task-volume-custom').fill('1');const splitTarget=path.join(outputDir,'split.zip');await splitTask.locator('#archive-task-path').fill(splitTarget);
  await splitTask.locator('#archive-task-start').click();await expect(splitTask.locator('#archive-task-feedback')).toContainText('已创建',{timeout:30000});await fs.stat(splitTarget);await fs.stat(path.join(outputDir,'split.z01'));await close(splitTask);

  await request('archive-create-zip',[other]);const quickZip=await task();
  await expect(quickZip.locator('#archive-task-feedback')).toContainText('已创建',{timeout:30000});
  await fs.stat(path.join(sourceDir,'second.zip'));await close(quickZip);
  await request('archive-create-7z',[source]);const quickSeven=await task();
  await expect(quickSeven.locator('#archive-task-feedback')).toContainText('已创建',{timeout:30000});
  await fs.stat(path.join(sourceDir,'sample.7z'));await close(quickSeven);

  if(process.env.ONE_CAPTURE_ARCHIVE_TASK){
   const large=path.join(sourceDir,'progress.bin'),file=await fs.open(large,'w');
   try{for(let i=0;i<16;i++)await file.write(crypto.randomBytes(8*1024*1024));}finally{await file.close();}
   await request('archive-create-zip',[large]);const compressing=await task();
   await expect(compressing.locator('#archive-task-progress')).toBeVisible({timeout:30000});await capture(compressing,'compression-running');
   await expect(compressing.locator('#archive-task-feedback')).toContainText('已创建',{timeout:60000});await close(compressing);
   await request('archive-folder',[path.join(sourceDir,'progress.zip')]);const extracting=await task();
   await expect(extracting.locator('#archive-task-progress')).toBeVisible({timeout:30000});await capture(extracting,'extraction-running');
   await expect(extracting.locator('#archive-task-feedback')).toContainText('已解压',{timeout:60000});await close(extracting);
  }

  await request('archive-folder',[manualTarget]);const folder=await task();
  await expect(folder.locator('#archive-task-feedback')).toContainText('已解压',{timeout:30000});
  assert.equal(await fs.readFile(path.join(outputDir,'manual','sample.txt'),'utf8'),'Archive shell request\n');await close(folder);

  await request('archive-choose',[manualTarget]);const chosen=await task();
  const customDestination=path.join(root,'selected-output');await fs.mkdir(customDestination);
  await expect(chosen.locator('#archive-task-directory')).toHaveValue(outputDir);
  await capture(chosen,'extraction-choose-path');
  await chosen.locator('#archive-task-directory').fill(customDestination);
  await chosen.locator('#archive-task-start').click();
  await expect(chosen.locator('#archive-task-feedback')).toContainText('已解压',{timeout:30000});
  assert.equal(await fs.readFile(path.join(customDestination,'sample.txt'),'utf8'),'Archive shell request\n');await close(chosen);

  const secret=path.join(outputDir,'secret.zip');createFixture(secret,'correct');
  await request('archive-smart',[secret]);const password=await task();
  await expect(password.locator('#archive-task-password-panel')).toBeVisible();
  await expect(password.locator('#archive-task-progress')).toBeHidden();await capture(password,'extraction-password');
  await password.locator('#archive-task-auto-close').check();
  await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8')).archive.closeOnComplete).toBe(true);
  await password.locator('#archive-task-password').fill('wrong');await password.locator('#archive-task-start').click();
  await expect(password.locator('#archive-task-feedback.error')).toBeVisible({timeout:30000});await capture(password,'extraction-error');
  await password.waitForTimeout(1800);assert.equal(app.windows().includes(password),true,'errors must keep the task window open');
  await password.locator('#archive-task-password').fill('correct');await password.locator('#archive-task-start').click();
  await expect(password.locator('#archive-task-feedback')).toContainText('已解压',{timeout:30000});await capture(password,'extraction-complete');
  assert.equal(await fs.readFile(path.join(outputDir,'sample.txt'),'utf8'),'Archive shell request\n');
  await expect.poll(()=>app.windows().includes(password),{timeout:4000}).toBe(false);

  const occupied=path.join(outputDir,'occupied.zip');await fs.mkdir(occupied);
  await request('archive-create',[source]);const failedCreate=await task();
  await failedCreate.locator('#archive-task-path').fill(occupied);await failedCreate.locator('#archive-task-start').click();
  await expect(failedCreate.locator('#archive-task-feedback.error')).toBeVisible({timeout:30000});await capture(failedCreate,'compression-error');
  await failedCreate.waitForTimeout(1800);assert.equal(app.windows().includes(failedCreate),true,'compression errors must keep the task window open');
  await close(failedCreate);

  await request('archive-extract',[manualTarget]);const main=await app.firstWindow();
  await expect(main.locator('[data-page="archive"]')).toHaveClass(/active/,{timeout:20000});
  await expect(main.locator('#archive-source')).toHaveValue(manualTarget);
  await expect(main.locator('.archive-entry-name')).toHaveText('sample.txt',{timeout:20000});
  await main.locator('[data-archive-mode="create"]').click();await main.locator('#archive-advanced-open').click();
  await main.locator('#archive-volume').click();await main.getByRole('option',{name:'约 4.7 GB'}).click();await expect(main.locator('#archive-advanced-summary')).toContainText('约 4.7 GB');
  await main.locator('#archive-volume').click();await main.getByRole('option',{name:'自定义大小…'}).click();await expect(main.locator('#archive-volume-custom-row')).toBeVisible();
  console.log('Archive shell passed: standalone manual and quick creation, extraction progress, password before extraction, and browse in main window.');
 }finally{await app.close();const relative=path.relative(base,root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
