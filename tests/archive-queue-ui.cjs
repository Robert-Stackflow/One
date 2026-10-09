const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-queue-ui-'));let app;
 try{
  const source=path.join(root,'input.txt'),archive=path.join(root,'queue.zip');await fs.writeFile(source,'queue UI source');
  const made=spawnSync(path.resolve('dist/native/One.Archive.exe'),['create',archive,source],{input:Buffer.alloc(4),encoding:'utf8',env:{...process.env,TEMP:root,TMP:root},windowsHide:true});assert.equal(made.status,0,made.stdout);
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({shell})=>{
   globalThis.explorerCalls=0;shell.showItemInFolder=()=>globalThis.explorerCalls++;shell.openPath=async()=>{globalThis.explorerCalls++;return '';};
   const cp=process.getBuiltinModule('node:child_process'),spawn=cp.spawn;globalThis.holdQueueTest=true;
   cp.spawn=function(file,args,...rest){const child=spawn.call(this,file,args,...rest);if(globalThis.holdQueueTest&&String(file).endsWith('One.Archive.exe')&&args[0]==='test'){
    globalThis.holdQueueTest=false;const end=child.stdin.end.bind(child.stdin);child.stdin.end=(...input)=>{globalThis.releaseQueueTest=()=>{globalThis.releaseQueueTest=undefined;end(...input);};return child.stdin;};
   }return child;};
  });
  await page.evaluate(()=>window.one.patchSettings({archive:{maxConcurrent:1}}));
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  await page.evaluate(({archive,ids})=>{window.queueResults=[];window.queueRuns=ids.map(id=>window.one.archiveRun({operation:'test',path:archive},id).then(result=>{window.queueResults.push({id,ok:true});return result;},error=>{window.queueResults.push({id,ok:false,message:String(error)});}));}, {archive,ids});
  await expect.poll(()=>app.evaluate(()=>typeof globalThis.releaseQueueTest)).toBe('function');
  await page.locator('[data-page="home"]').click();await expect(page.locator('#overview-active')).toContainText('排队中 · 第 2 位');
  const row=page.locator('.overview-task-row').filter({has:page.locator(`[data-overview-cancel="${ids[1]}"]`)});await expect(row).toContainText('排队中 · 第 1 位');await row.locator('button').click();
  await expect(page.locator('#overview-active')).not.toContainText('第 2 位');await expect(page.locator('#overview-active')).toContainText('排队中 · 第 1 位');
  await app.evaluate(()=>globalThis.releaseQueueTest());await page.evaluate(()=>Promise.all(window.queueRuns));
  await expect(page.locator('#overview-active')).not.toContainText('校验压缩包');
  const results=await page.evaluate(()=>window.queueResults);assert.equal(results.filter(item=>item.ok).length,2);assert(results.find(item=>item.id===ids[1]).message.includes('取消'));
  await expect(page.locator('#overview-history')).toContainText('已取消');assert.equal(await app.evaluate(()=>globalThis.explorerCalls),0);assert.deepEqual(errors,[]);
  console.log('Archive queue UI passed: real waiting helper, visible queue positions, overview cancellation, remaining jobs finish, no renderer errors or Explorer calls.');
 }finally{if(app)await app.close();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
