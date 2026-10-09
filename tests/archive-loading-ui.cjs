// Isolated renderer checks: no native archive jobs, Explorer windows or user data.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');
const {_electron:electron,expect}=require('@playwright/test');

(async()=>{
 await fs.mkdir('work/temp',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-loading-'));let app;
 try{
  await build({stdin:{contents:"export {archivePage,setupArchiveView} from './src/renderer/archive-view';export {customControls} from './src/renderer/controls';export {renderArchivePreview} from './src/renderer/archive-preview';",resolveDir:path.resolve('.')},bundle:true,format:'iife',globalName:'ArchiveUI',outfile:path.join(root,'view.js'),logLevel:'silent'});
  const css=await fs.readFile('src/renderer/styles.css','utf8')+await fs.readFile('src/renderer/interface-refinement.css','utf8');
  await fs.writeFile(path.join(root,'base.css'),css);
  await fs.writeFile(path.join(root,'page.html'),`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="view.css"><div id="app"><div class="shell"><aside class="sidebar"><div class="brand">One</div><nav class="sidebar-navigation">${Array.from({length:26},(_,i)=>`<button class="nav">导航 ${i+1}</button>`).join('')}</nav></aside><main class="workspace"><header class="workspace-header"></header><div class="content" data-current-page="archive"><div class="page-heading"><h1>压缩与解压</h1></div><section class="page" id="page-archive"></section></div></main></div></div><script src="view.js"></script><script>document.querySelector('#page-archive').innerHTML=ArchiveUI.archivePage();ArchiveUI.customControls(document.querySelector('#page-archive'));window.controller=ArchiveUI.setupArchiveView();</script>`);
  await fs.writeFile(path.join(root,'main.cjs'),"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const window=new BrowserWindow({width:1550,height:1020,show:false});window.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());");
  const env={...process.env,TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.join(root,'main.cjs')],env});const page=await app.firstWindow(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{
   window.pending=[];window.cancelled=[];window.cancelMode='accept';
   window.one={settings:async()=>({archive:{openCompleted:false,compressionLevel:6,threads:2,memoryMiB:1024,conflict:'rename',defaultFormat:'zip'}}),patchSettings:async()=>{},onArchivePreferences:()=>{},onArchiveCancelRequested:fn=>window.cancelRequested=fn,onArchiveProgress:fn=>window.progress=fn,
    archiveRun:(request,id)=>new Promise((resolve,reject)=>window.pending.push({request,id,resolve,reject})),
    archiveCancel:async id=>{window.cancelled.push(id);if(window.cancelMode==='fail')throw Error('IPC unavailable');return window.cancelMode!=='sealed';},
    pickFile:async()=>'',pickDirectory:async()=>'',revealFile:async()=>{throw Error('Should not open Explorer');}};
   window.completeList=()=>{const task=window.pending.at(-1);task.resolve({path:task.request.path,revision:'v2:test',total:200,offset:0,matched:200,comment:'备注',editable:true,entries:Array.from({length:200},(_,index)=>({index,name:`文件-${index}.txt`,size:1024,compressed:500,directory:false,encrypted:false}))});};
   window.emit=(operation,done=0,total=0)=>window.progress({id:window.pending.at(-1).id,operation,done,total});
  });
  await page.goto(pathToFileURL(path.join(root,'page.html')).href);
  const size=async(width,height)=>{await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});};
  const fits=async(action)=>{
   const metrics=await page.evaluate(selector=>{const content=document.querySelector('.content'),area=document.querySelector('.archive-work-area'),button=document.querySelector(selector),rect=button.getBoundingClientRect(),bounds=area.getBoundingClientRect();return{overflow:content.scrollHeight-content.clientHeight,buttonBottom:rect.bottom,areaBottom:bounds.bottom,buttonTop:rect.top,areaTop:bounds.top,horizontal:content.scrollWidth-content.clientWidth};},action);
   assert(metrics.overflow<=1,JSON.stringify(metrics));assert(metrics.horizontal<=1,JSON.stringify(metrics));assert(metrics.buttonBottom<=metrics.areaBottom+1&&metrics.buttonTop>=metrics.areaTop,JSON.stringify(metrics));
  };
  const preview=process.env.ONE_ARCHIVE_LAYOUT_PREVIEW;
  if(preview)await fs.mkdir(preview,{recursive:true});
  for(const [width,height]of[[1550,1020],[1240,840],[840,620]]){await size(width,height);await fits('#archive-create');}
  await size(1550,1020);
  await page.locator('#archive-sources-open').click();await page.locator('#archive-sources').fill('D:\\资料\\文件.txt');await page.locator('#archive-sources-done').click();await expect(page.locator('#archive-sources-dialog')).not.toBeVisible();
  await page.locator('#archive-advanced-open').click();await page.locator('#archive-volume').fill('10');await page.locator('#archive-advanced-done').click();await expect(page.locator('#archive-advanced-dialog')).not.toBeVisible();
  await expect(page.locator('#archive-advanced-summary')).toContainText('10 MB');
  if(preview)await page.screenshot({path:path.join(preview,'create.png')});
  await page.locator('[data-archive-mode="browse"]').click();await page.locator('#archive-source').fill('D:\\资料\\测试.zip');await page.locator('#archive-open').click();
  await expect(page.locator('#archive-loading')).toBeVisible();await expect(page.locator('#archive-cancel')).toBeEnabled();
  await page.evaluate(()=>window.emit('queue'));await expect(page.locator('#archive-loading-title')).toContainText('等待可用资源');
  if(preview)await page.screenshot({path:path.join(preview,'loading.png')});
  await page.locator('#archive-cancel').click();await expect(page.locator('#archive-cancel')).toBeDisabled();
  assert.equal(await page.evaluate(()=>window.cancelled.length),1);
  await page.evaluate(()=>window.pending.at(-1).reject(Error('压缩任务已取消')));await expect(page.locator('#archive-loading')).toBeHidden();await expect(page.locator('#archive-open')).toBeEnabled();
  await page.locator('#archive-open').click();await page.evaluate(()=>window.completeList());await expect(page.locator('.archive-entry')).toHaveCount(200);await expect(page.locator('#archive-status')).toBeHidden();
  for(const [width,height]of[[1550,1020],[1240,840],[840,620]]){await size(width,height);await fits('#archive-extract-selected');}
  await size(1550,1020);await page.locator('.archive-entry input').first().check();await page.locator('#archive-list-head').click();await expect(page.locator('[data-archive-edit="rename"]')).toBeEnabled();await page.keyboard.press('Escape');
  if(preview)await page.screenshot({path:path.join(preview,'browse.png')});
  await page.locator('#archive-list-head').click();await page.locator('#archive-test').click();await page.evaluate(()=>window.emit('test',5,20));await expect(page.locator('#archive-loading-progress')).toHaveAttribute('value','5');
  await page.evaluate(()=>window.emit('commit'));await expect(page.locator('#archive-loading')).toBeVisible();await expect(page.locator('#archive-cancel')).toBeHidden();
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.cancelled.length),1);
  await page.evaluate(()=>window.pending.at(-1).resolve({path:'D:\\资料\\测试.zip',count:200}));await expect(page.locator('#archive-loading')).toBeHidden();
  await expect(page.locator('#archive-result-title')).toHaveText('校验通过');await expect(page.locator('#archive-result-message')).toContainText('200');await page.locator('#archive-result-done').click();await expect(page.locator('#archive-result-dialog')).not.toBeVisible();await size(840,620);await fits('#archive-extract-selected');
  // Even a task completed without progress events leaves an explicit result to dismiss.
  await page.locator('#archive-list-head').click();await page.locator('#archive-test').click();
  await page.evaluate(()=>window.pending.at(-1).resolve({path:'D:\\资料\\测试.zip',count:1}));
  await expect(page.locator('#archive-result-dialog')).toBeVisible();await expect(page.locator('#archive-result-title')).toHaveText('校验通过');await expect(page.locator('#archive-result-message')).toContainText('1 项');
  await page.locator('#archive-result-done').click();await expect(page.locator('#archive-result-dialog')).not.toBeVisible();
  await page.locator('#archive-list-head').click();await page.locator('#archive-test').click();
  await page.evaluate(()=>window.pending.at(-1).reject(Error('压缩包数据损坏，CRC 校验失败')));
  await expect(page.locator('#archive-result-title')).toHaveText('校验未完成');await expect(page.locator('#archive-result-message')).toContainText('CRC 校验失败');
  await page.locator('#archive-result-done').click();await expect(page.locator('#archive-result-dialog')).not.toBeVisible();
  // A successful completion racing with Stop must still report the confirmed result.
  await page.locator('#archive-list-head').click();await page.locator('#archive-test').click();await page.locator('#archive-cancel').click();
  await page.evaluate(()=>window.pending.at(-1).resolve({path:'D:\\资料\\测试.zip',count:200}));
  await expect(page.locator('#archive-result-title')).toHaveText('校验通过');await page.locator('#archive-result-done').click();await expect(page.locator('#archive-result-dialog')).not.toBeVisible();
  await page.locator('#archive-list-head').click();await page.locator('#archive-test').click();await page.evaluate(()=>window.cancelMode='fail');await page.locator('#archive-cancel').click();await expect(page.locator('#archive-loading-hint')).toContainText('可以重试');
  await page.evaluate(()=>window.cancelMode='accept');await page.keyboard.press('Escape');await expect(page.locator('#archive-cancel')).toBeDisabled();
  await page.evaluate(()=>window.pending.at(-1).reject(Error('Error invoking remote method \'one:archive-run\': ArchiveFailure: 已取消')));await expect(page.locator('#archive-loading')).toBeHidden();await expect(page.locator('#archive-status-text')).toHaveText('已取消');
  await fits('#archive-extract-selected');
  await page.locator('#archive-decode-open').click();await page.locator('#archive-password').fill('secret');await page.locator('#archive-decode-done').click();await expect(page.locator('#archive-loading')).toBeVisible();await page.evaluate(()=>window.completeList());await expect(page.locator('#archive-decode-summary')).toContainText('已设置密码');
  await size(1550,1020);await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.style.setProperty('--surface','#202022');document.documentElement.style.setProperty('--accent','#ededee');document.documentElement.style.setProperty('--on-accent','#202022');});
  if(preview)await page.screenshot({path:path.join(preview,'browse-dark.png')});
  await page.evaluate(()=>{
   window.previewRequests=[];window.one.previewArchive=(request,id)=>new Promise((resolve,reject)=>window.previewRequests.push({request,id,resolve,reject}));
   const host=document.createElement('div');host.id='archive-preview-test';host.style.cssText='position:fixed;inset:0;background:white;z-index:99';document.body.append(host);window.disposeArchivePreview=ArchiveUI.renderArchivePreview(host,'D:\\资料\\测试.7z');
  });
  await expect(page.locator('.archive-preview [data-loading]')).toBeVisible();
  await page.evaluate(()=>window.previewRequests.at(-1).resolve({path:'D:\\资料\\测试.7z',total:1,offset:0,comment:'',entries:[{name:'资料/',index:0,directory:true,size:0,compressed:0,encrypted:false}]}));
  await expect(page.locator('.archive-preview-entry')).toHaveCount(1);await expect(page.locator('.archive-preview [data-loading]')).toBeHidden();
  await page.locator('.archive-preview-entry').click();await expect.poll(()=>page.evaluate(()=>window.previewRequests.at(-1).request.browse.directory)).toBe('资料/');
  await page.evaluate(()=>window.disposeArchivePreview());await expect(page.locator('.archive-preview')).toHaveCount(0);
  await page.evaluate(()=>window.previewRequests.at(-1).resolve({entries:[]}));
  assert.deepEqual(errors,[]);
  console.log('Archive renderer checks passed: page height at three sizes, option dialogs, loading/cancel/retry, final-save protection, selection and error recovery. No native jobs or Explorer windows.');
 }finally{
  if(app)await app.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
