const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{_electron:electron,expect}=require('@playwright/test');
const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/display-management','ui');let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
async function main(){
 await fs.mkdir(output,{recursive:true});const profile=await fs.mkdtemp(path.join(output,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_DISPLAY_MANAGEMENT:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env,timeout:30000});
 try{
  await app.evaluate((_electron,exe)=>{
   globalThis.displayCalls=[];globalThis.displayReverse=false;globalThis.displayHoldProbe=false;globalThis.displayHoldSet=false;globalThis.displayAborts=0;globalThis.displayActive=0;globalThis.displayMaxActive=0;
   const service=globalThis.oneTestDisplayManagement;service.helper=exe;const invoke=service.invoke;
   service.invoke=async(args,signal)=>{
    globalThis.displayCalls.push(args);globalThis.displayActive++;globalThis.displayMaxActive=Math.max(globalThis.displayMaxActive,globalThis.displayActive);
    try{
     if(args[0]==='probe'&&globalThis.displayHoldProbe||args[0]==='set'&&globalThis.displayHoldSet)await new Promise((resolve,reject)=>{globalThis.displayRelease=resolve;signal.addEventListener('abort',()=>{globalThis.displayAborts++;reject(Error('已取消'));},{once:true});});
     const raw=await invoke(args,signal);
     if(args[0]==='list'&&globalThis.displayReverse)raw.displays.reverse();
     if(args[0]==='probe'&&args[1]==='mock-a')raw.controls.volume={supported:false,method:'',error:'未提供显示器音量接口'};return raw;
    }finally{globalThis.displayActive--;}
   };
  },path.resolve('work/current/display-management/native-build/One.Display.Test.exe'));
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('[data-page=input]');await page.locator('[data-page=input]').click();await page.locator('[data-enhancement-tab=displays]').click();
  const cardA=page.locator('#display-detail article').filter({has:page.locator('h3',{hasText:'测试显示器 A'})}).filter({hasText:'DISPLAY1'}),cardB=page.locator('#display-detail article').filter({has:page.locator('h3',{hasText:'测试显示器 B'})});
  await expect(page.locator('#display-detail article')).toHaveCount(4);await expect(cardA.locator('input[data-parameter=brightness]')).toBeEnabled();await expect(cardB.locator('input[data-parameter=brightness]')).toBeEnabled();await expect.poll(()=>app.evaluate(()=>globalThis.displayCalls.filter(a=>a[0]==='probe').length)).toBe(2);checks++;
  eq(await page.locator('[data-page=displays]').count(),0);eq(await page.locator('#display-notice').textContent(),'');eq(await page.locator('#display-refresh').evaluate(e=>!!e.closest('.display-list-heading')),true,'Refresh is above screen cards');eq(await cardA.locator('input[data-parameter=volume]').isDisabled(),true);await expect(cardB.locator('input[data-parameter=volume]')).toBeEnabled();
  const identity=await cardB.getAttribute('data-display');await app.evaluate(()=>globalThis.displayReverse=true);await page.locator('#display-refresh').click();await expect(cardB.locator('input[data-parameter=brightness]')).toBeEnabled();eq(await cardB.getAttribute('data-display'),identity,'Reordering preserves device identity');
  const slider=cardB.locator('input[data-parameter=brightness]');await slider.evaluate(e=>{e.value='87';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});await expect.poll(()=>app.evaluate(()=>globalThis.displayCalls.filter(a=>a[0]==='set').at(-1)?.slice(1))).toEqual(['mock-b','serial:b','brightness','87']);checks++;
  // A response to an older write must not overwrite a new drag before its debounce expires.
  await app.evaluate(()=>{globalThis.displayRelease=undefined;globalThis.displayHoldSet=true;});await slider.evaluate(e=>{e.value='10';e.dispatchEvent(new Event('change',{bubbles:true}));});await expect.poll(()=>app.evaluate(()=>typeof globalThis.displayRelease)).toBe('function');await slider.evaluate(e=>{e.value='60';e.dispatchEvent(new Event('input',{bubbles:true}));});await app.evaluate(()=>{globalThis.displayHoldSet=false;globalThis.displayRelease();});await expect(slider).toHaveValue('60');await expect.poll(()=>app.evaluate(()=>globalThis.displayCalls.filter(a=>a[0]==='set').at(-1)?.[4])).toBe('60');checks++;
  await app.evaluate(()=>globalThis.displayHoldProbe=true);await page.locator('#display-refresh').click();await expect(page.locator('#display-detail header .display-state-chip').first()).toBeVisible();eq(await page.locator('#display-notice').textContent(),'');eq(await page.locator('#display-detail header .display-state-chip').first().textContent(),'检测中');await page.locator('[data-enhancement-tab=edges]').click();await expect.poll(()=>app.evaluate(()=>globalThis.displayAborts)).toBeGreaterThan(0);checks++;
  await app.evaluate(()=>globalThis.displayHoldProbe=false);await page.locator('[data-enhancement-tab=displays]').click();await expect(slider).toBeEnabled();await app.evaluate(()=>globalThis.oneTestDisplayManagement.invalidate());await expect(slider).toBeEnabled();await expect(cardB.locator('input[data-parameter=brightness]')).toBeEnabled();eq(await cardB.getAttribute('data-display'),identity,'Topology refresh keeps the correct hardware target');checks++;
  const layout=[];for(const width of [1242,1000]){
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,850),width);
   const result=await page.evaluate(()=>{const cards=[...document.querySelectorAll('#display-detail article')],rects=cards.map(e=>e.getBoundingClientRect());return {overflow:document.querySelector('.content').scrollWidth>document.querySelector('.content').clientWidth+1,aligned:new Set(rects.map(r=>Math.round(r.left))).size===1,stacked:rects.every((r,i)=>!i||r.top>=rects[i-1].bottom),sidebar:!!document.querySelector('.display-management aside'),refreshAligned:Math.abs(document.querySelector('.display-views').getBoundingClientRect().top+document.querySelector('.display-views').getBoundingClientRect().height/2-document.querySelector('#display-refresh').getBoundingClientRect().top-document.querySelector('#display-refresh').getBoundingClientRect().height/2)<2,tabs:[...document.querySelectorAll('[data-display-tab]')].map(e=>e.textContent)};});eq(result.overflow,false);eq(result.aligned,true);eq(result.stacked,true);eq(result.sidebar,false);eq(result.refreshAligned,true,'Refresh aligns with tabs');eq(result.tabs,['屏幕列表','参数方案','快捷键']);layout.push({width,...result});
   if(width===1242)await page.screenshot({path:path.join(output,'display-wide.png'),scale:'css'});
  }
  eq(await app.evaluate(()=>globalThis.displayMaxActive),1,'Native hardware requests serialize');eq(errors,[],'No renderer errors');const report={result:'PASS',checks,profile,layout,scope:'Real Electron UI/IPC with isolated native helper: operation tab, three tabs/stacked device cards, automatic bounded probes, header status, unsupported interfaces, stable identity after reorder, writes/coalescing/stale drag result, topology/leave cancellation. No real display settings written.'};await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
