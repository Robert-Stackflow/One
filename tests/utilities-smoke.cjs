const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
async function run(){
 const output=path.resolve('work/utilities-smoke');await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(output,'profile-')),files=await fs.mkdtemp(path.join(output,'files-'));
 const target=path.join(files,'held-文件.txt');await fs.writeFile(target,'held fixture');
 const holder=spawn(process.execPath,['-e',`require('fs').openSync(process.argv[1],'r');process.stdout.write('ready');setInterval(()=>{},1000)`,target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);});
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env});const errors=[];app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));
 try{
  const page=await app.firstWindow();await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source');await page.locator('[data-page=input]').click();await page.locator('#enhancement-tab-awake').click();
  await page.locator('#awake-start').click();await expect.poll(()=>page.evaluate(async()=>(await window.one.utilityState()).awake.active)).toBe(true);
  await app.evaluate(({powerMonitor})=>powerMonitor.emit('lock-screen'));assert.equal((await page.evaluate(()=>window.one.utilityState())).awake.active,false);
  await app.evaluate(({powerMonitor})=>powerMonitor.emit('unlock-screen'));assert.equal((await page.evaluate(()=>window.one.utilityState())).awake.active,true);
  await page.evaluate(async()=>{const s=await window.one.settings();s.utilities.awake={mode:'timed',display:true,expiresAt:Date.now()+1500};await window.one.saveSettings(s);});
  await expect.poll(()=>page.evaluate(async()=>(await window.one.utilityState()).awake.mode)).toBe('off');
  const hwnd=await app.evaluate(async({BrowserWindow})=>{const fixture=new BrowserWindow({title:'One topmost test fixture',width:360,height:220,show:true});await fixture.loadURL('data:text/html,<title>One topmost test fixture</title>Fixture');return Number(fixture.getNativeWindowHandle().readBigUInt64LE());});
  await page.evaluate(async()=>{const s=await window.one.settings();s.utilities.topmost.enabled=true;s.utilities.topmost.shortcut='';await window.one.saveSettings(s);});
  await page.evaluate(id=>window.one.toggleTopmost(id),hwnd);
  let item=(await page.evaluate(()=>window.one.topmostWindows())).find(w=>w.id===hwnd);assert.equal(item.managed,true);assert.equal(item.topmost,true);
  await page.evaluate(id=>window.one.toggleTopmost(id),hwnd);item=(await page.evaluate(()=>window.one.topmostWindows())).find(w=>w.id===hwnd);assert.equal(item.topmost,false);
  await page.evaluate(id=>window.one.toggleTopmost(id),hwnd);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='One topmost test fixture').destroy());
  await expect.poll(()=>page.evaluate(async()=>(await window.one.utilityState()).pinned)).toBe(0);
  await page.locator('[data-page=text]').click();const opening=app.waitForEvent('window');await page.evaluate(p=>window.one.preview(p),target);const preview=await opening;await expect(preview.locator('#preview-name')).toHaveText(path.basename(target));if(await preview.locator('#preview-files').getAttribute('aria-pressed')!=='true')await preview.locator('#preview-files').click();await preview.locator('#side-details').click();await preview.locator('#preview-more').click();await preview.locator('#preview-locks').click();await expect(page.locator('#file-lock-card')).toBeVisible();await expect(page.locator('#lock-targets')).toContainText(target);
  await expect.poll(()=>page.evaluate(async()=>(await window.one.lockState()).running),{timeout:100000}).toBe(false);
  const state=await page.evaluate(()=>window.one.lockState());const match=state.processes.find(p=>p.pid===holder.pid);if(!match)console.log(JSON.stringify({...state,processes:state.processes.map(p=>({pid:p.pid,files:p.files})),expectedPid:holder.pid},null,2));assert.ok(match,'held file process must be found');assert.ok(match.files.includes(target));
  await page.locator(`[data-end="${match.token}"]`).click();await expect(page.locator('#lock-end-dialog')).toBeVisible();await page.locator('#lock-end-cancel').click();assert.equal(holder.exitCode,null);
  await page.locator(`[data-end="${match.token}"]`).click();await page.locator('#lock-end-confirm').click();await expect.poll(()=>holder.exitCode).not.toBe(null);
  await page.screenshot({path:path.join(output,'桌面工具.png'),fullPage:true});
  await page.evaluate(p=>window.one.scanLocks([p]),files);await page.evaluate(()=>window.one.cancelLocks());assert.equal((await page.evaluate(()=>window.one.lockState())).cancelled,true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',awake:true,lockPause:true,expiry:true,topmost:true,closedWindowPruned:true,heldFileFound:true,explicitTerminate:true,cancel:true,scan:{checked:state.checked,total:state.total,denied:state.denied,timedOut:state.timedOut},output},null,2));
 }finally{await app.close();if(holder.exitCode===null)holder.kill();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
