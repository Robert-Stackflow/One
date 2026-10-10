const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{_electron:electron,expect}=require('@playwright/test');
const output=path.resolve('work/current/display-linking/ui');let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
async function main(){
 await fs.mkdir(output,{recursive:true});const profile=await fs.mkdtemp(path.join(output,'profile-'));const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_DISPLAY_MANAGEMENT:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app;const errors=[];
 const boot=async()=>{
  app=await electron.launch({args:[path.resolve('.')],env,timeout:30000});
  await app.evaluate((_electron,exe)=>{const service=globalThis.oneTestDisplayManagement;service.helper=exe;const invoke=service.invoke;globalThis.linkCalls=[];globalThis.linkFail='';service.invoke=async(args,signal)=>{globalThis.linkCalls.push(args);if(args[0]==='set'&&args[1]===globalThis.linkFail)return {error:'测试屏幕写入失败'};return invoke(args,signal);};},path.resolve('work/current/display-management/native-build/One.Display.Test.exe'));
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('[data-page=input]').click();await page.locator('[data-enhancement-tab=displays]').click();await expect(page.locator('#display-detail input[data-parameter=brightness]')).toBeEnabled();await expect.poll(()=>app.evaluate(()=>globalThis.linkCalls.filter(a=>a[0]==='probe').length)).toBe(2);return page;
 };
 try{
  let page=await boot();const choose=async name=>{await page.locator('#display-list [role=option]').filter({hasText:'测试显示器 '+name}).filter({hasText:name==='A'?'DISPLAY1':'DISPLAY2'}).click();await expect(page.locator('#display-detail h3')).toHaveText('测试显示器 '+name);};
  const write=async value=>{await page.locator('#display-detail input[data-parameter=brightness]').evaluate((e,value)=>{e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);};
  const sets=()=>app.evaluate(()=>globalThis.linkCalls.filter(a=>a[0]==='set').map(a=>[a[1],a[4]]));
  eq(await page.locator('#display-linked').isChecked(),false,'Linking defaults off');eq(await sets(),[],'Detection and opening do not write brightness');
  await page.locator('#display-linked').check();await expect(page.locator('#display-linked')).toBeEnabled();await expect(page.locator('#display-linked')).toBeChecked();eq(await sets(),[],'Enabling linking does not immediately apply values');
  await write(66);await expect.poll(sets).toEqual([['mock-a','66'],['mock-b','66']]);await expect(page.locator('#display-detail input[data-parameter=brightness]')).toHaveValue('66');checks++;
  await choose('B');await expect(page.locator('#display-detail input[data-parameter=brightness]')).toHaveValue('66');checks++;
  await page.locator('#display-participate').uncheck();await expect(page.locator('#display-participate')).toBeEnabled();await expect(page.locator('#display-participate')).not.toBeChecked();const count=(await sets()).length;eq(count,2,'Excluding a screen does not write');
  await choose('A');await write(44);await expect.poll(sets).toEqual([['mock-a','66'],['mock-b','66'],['mock-a','44']]);checks++;
  await page.locator('#display-participate').uncheck();await expect(page.locator('#display-participate')).toBeEnabled();const stored=JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8'));eq(stored.displays.linkedBrightness,true);eq(stored.displays.excluded.length,2,'Per-screen exclusions persist by opaque stable identity');
  await app.close();app=undefined;page=await boot();await expect(page.locator('#display-linked')).toBeChecked();await expect(page.locator('#display-participate')).not.toBeChecked();eq(await sets(),[],'Restart restores preferences without applying brightness');
  await page.locator('#display-participate').check();await expect(page.locator('#display-participate')).toBeEnabled();await choose('B');await page.locator('#display-participate').check();await expect(page.locator('#display-participate')).toBeEnabled();await choose('A');
  await app.evaluate(()=>globalThis.linkFail='mock-b');await write(73);await expect(page.locator('#display-link-error')).toContainText('1 块屏幕调整失败');await expect(page.locator('#display-detail input[data-parameter=brightness]')).toHaveValue('73');await expect(page.locator('#display-detail input[data-parameter=brightness]')).toBeEnabled();checks++;
  await choose('B');await expect(page.locator('#display-detail .display-error')).toContainText('测试屏幕写入失败');await expect(page.locator('#display-detail input[data-parameter=brightness]')).toBeDisabled();checks++;
  await app.evaluate(()=>globalThis.linkFail='');await page.locator('.display-retry').click();await expect(page.locator('#display-detail input[data-parameter=brightness]')).toBeEnabled();await page.locator('#display-linked').uncheck();await expect(page.locator('#display-linked')).toBeEnabled();await write(22);await expect.poll(sets).toEqual([['mock-a','73'],['mock-b','73'],['mock-b','22']]);checks++;
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,850));eq(await page.evaluate(()=>document.querySelector('.content').scrollWidth<=document.querySelector('.content').clientWidth+1),true,'Link controls fit minimum window width');await page.screenshot({path:path.join(output,'display-linking.png'),scale:'css'});
  eq(errors,[]);const report={result:'PASS',checks,profile,scope:'Real Electron UI/IPC, isolated native helper: default/opt-in linking, group updates, independent exclusions, disk persistence/restart without writes, partial failure and recovery, disabling, minimum width. No real hardware writes.'};await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
