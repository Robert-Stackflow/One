const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');

async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/locksmith-commandline-smoke');
 await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'profile-'));
 const target=path.join(out,'opened in editor.mdx');
 await fs.writeFile(target,'fixture');
 const title='opened in editor - Test Editor',editorScript=path.join(out,'editor-window.cjs');
 await fs.writeFile(editorScript,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const window=new BrowserWindow({x:-30000,y:-30000,width:300,height:200,show:false});window.showInactive();window.setTitle(${JSON.stringify(title)});process.stdout.write('ready\\n');});app.on('window-all-closed',()=>app.quit());`);
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',target],{windowsHide:true,stdio:'ignore'});
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app,editor;
 try{
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  app=await electron.launch({args:[path.resolve('.')],env});
  const page=await app.firstWindow();
  await page.waitForSelector('#overview-index');
  const editorEnv={...process.env};delete editorEnv.ELECTRON_RUN_AS_NODE;
  editor=spawn(require('electron'),[editorScript],{windowsHide:true,env:editorEnv,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Editor window did not open')),15000);editor.stdout.once('data',()=>{clearTimeout(timer);resolve();});editor.once('error',error=>{clearTimeout(timer);reject(error);});editor.once('exit',code=>{clearTimeout(timer);reject(new Error('Editor window exited: '+code));});});
  await page.evaluate(file=>window.one.inspectLocks(file),target);
  await expect.poll(()=>page.evaluate(async()=>(await window.one.lockState()).targets)).toEqual([target]);
  await expect.poll(()=>page.evaluate(async()=>(await window.one.lockState()).total),{timeout:15000}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(async()=>(await window.one.lockState()).running),{timeout:100000}).toBe(false);
  const state=await page.evaluate(()=>window.one.lockState());
  const match=state.processes.find(process=>process.pid===child.pid);
  assert.ok(match,'a process launched with the file path appears in results: '+JSON.stringify({error:state.error,checked:state.checked,total:state.total,denied:state.denied,timedOut:state.timedOut,processes:state.processes.length}));
  assert.deepEqual(match.files,[]);
  assert.deepEqual(match.references,[target]);
  const windowMatch=state.processes.find(process=>process.pid===editor.pid);
  assert.ok(windowMatch,'editor window title should appear even without an open file handle');
  assert.deepEqual(windowMatch.files,[]);
  assert.deepEqual(windowMatch.windows,[title]);
  await expect(page.locator('.lock-process').filter({hasText:'启动参数中发现文件路径'})).toHaveCount(1);
  await expect(page.locator('.lock-process').filter({hasText:'窗口标题匹配文件名（疑似打开）'})).toHaveCount(1);
  assert.equal(await page.locator('.lock-process button[data-end]').count(),0);
  await page.screenshot({path:path.join(out,'reference-result.png')});
  console.log(JSON.stringify({result:'PASS',pid:child.pid,referenceFound:true,windowTitleFound:true,terminationHidden:true}));
 }finally{child.kill();editor?.kill();if(app)await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
