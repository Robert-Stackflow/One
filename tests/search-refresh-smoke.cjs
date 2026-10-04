const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-refresh-smoke');await fs.mkdir(out,{recursive:true});
 const profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(out,'settings.cjs'),bundle:true,platform:'node'});
 const settings=require(path.join(out,'settings.cjs')).defaultSettings();settings.diskMonitor.enabled=false;settings.diskMonitor.notify=false;settings.search.roots=[];
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[],reports=[];app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');
  await app.evaluate(({BrowserWindow})=>{
   // This test receives keys through CDP; avoid taking focus from the user's apps.
   BrowserWindow.prototype.focus=function(){};
   BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive;
   for(const w of BrowserWindow.getAllWindows())w.hide();
  });
  await main.evaluate(async()=>{await window.one.patchSettings({search:{explorerTyping:true,shortcut:''}});await window.one.patchSettings({search:{explorerTyping:false}});});
  await expect.poll(()=>app.windows().filter(p=>new URL(p.url()||'about:blank').searchParams.get('view')==='search').length).toBe(1);
  await expect.poll(()=>app.evaluate(({ipcMain})=>ipcMain._invokeHandlers.has('one:search-files'))).toBe(true);
  await app.evaluate(async({ipcMain,app})=>{
   global.fixture={delay:30,reverse:false,remove:-1000,version:0};global.calls=[];global.completed=[];global.actions=[];global.iconCalls=0;
   const icon=(await app.getFileIcon(process.execPath,{size:'normal'})).toDataURL();
   ipcMain.removeHandler('one:file-icons');ipcMain.handle('one:file-icons',(_e,paths)=>{global.iconCalls++;return Object.fromEntries(paths.map(p=>[p,icon]));});
   for(const name of ['search-choose','preview','reveal-file','search-context-menu']){const channel='one:'+name;if(ipcMain._invokeHandlers.has(channel)){ipcMain.removeHandler(channel);ipcMain.handle(channel,(_e,...args)=>{global.actions.push({name,args});});}}
   ipcMain.removeHandler('one:search-files');ipcMain.handle('one:search-files',async(event,query,foldersOnly,token)=>{
    const fixture={...global.fixture},id=global.calls.length,text=query.replace(/^(app:|setting:|folder:|doc:|pic:|video:|audio:)?\s*/,'');
    const record={id,query,foldersOnly,token,sender:event.sender.id,started:Date.now()};global.calls.push(record);
    await new Promise(r=>setTimeout(r,text==='slow'?700:fixture.delay));
    const order=Array.from({length:100},(_,i)=>i);if(fixture.reverse)order.reverse();
    const launchKind=query.startsWith('app:')?'app':query.startsWith('setting:')?'setting':undefined;
    const items=order.filter(i=>i!==fixture.remove).map(i=>({path:'D:\\fixture\\Entry_'+i+'.txt',name:(text||'x_bea')+' '+String(i).padStart(3,'0')+'.txt',directory:false,size:10,modified:0,subtitle:'D:\\fixture\\Entry_'+i+'.txt'+(fixture.version?' · v'+fixture.version:''),launchKind}));
    global.completed.push({...record,finished:Date.now()});return text==='canceled'?{items:[],total:0,elapsed:fixture.delay,cancelled:true}:{items,total:100,elapsed:fixture.delay};
   });
  });
  await main.evaluate(()=>window.one.showSearch());
  await expect.poll(()=>app.windows().filter(p=>new URL(p.url()||'about:blank').searchParams.get('view')==='search').length).toBe(2);
  const pages=app.windows().filter(p=>new URL(p.url()||'about:blank').searchParams.get('view')==='search');
  const configure=patch=>app.evaluate((_e,patch)=>Object.assign(global.fixture,patch),patch);
  const counts=()=>app.evaluate(()=>({calls:global.calls.length,completed:global.completed.length,icons:global.iconCalls,actions:global.actions.length}));
  for(const embedded of [false,true]){
   const page=pages.find(p=>p.url().includes('embedded=1')===embedded),win=await app.browserWindow(page);await page.waitForSelector('#file-query');
   await configure({delay:30,reverse:false,remove:-1000,version:0});
   await win.evaluate((w,embedded)=>{w.removeAllListeners('blur');w.setBounds({x:-10000,y:-10000,width:embedded?540:740,height:embedded?390:560});w.showInactive();w.webContents.send('one:search-reset');},embedded);
   const initialContext=await page.evaluate(()=>window.one.searchContext());
   await win.evaluate((w,context)=>w.webContents.send('one:search-context',context),initialContext);
   await expect(page.locator('#file-query')).toHaveValue('');
   let updateVersion=0;
   const send=(channel='one:search-state',running=false)=>win.evaluate((w,value)=>w.webContents.send(value.channel,{running:value.running,count:100,scanned:100,issues:0,root:'D:\\fixture',updated:value.updated,error:'',watching:false}),{channel,running,updated:Date.now()+ ++updateVersion});
   const ready=()=>expect(page.locator('#search-results')).toHaveAttribute('aria-busy','false');
   const selected=()=>page.locator('.search-result.selected [data-file-icon]').getAttribute('data-file-icon');
   await page.locator('#file-query').fill('x_bea');await expect(page.locator('.search-result')).toHaveCount(100);await ready();
   await expect(page.locator('.search-result[aria-selected]')).toHaveCount(100);
   await expect(page.locator('.search-result[aria-selected=true]')).toHaveCount(1);
   await expect(page.locator('.windows-file-icon')).toHaveCount(100);
   for(let i=0;i<5;i++)await page.keyboard.press('ArrowDown');assert.equal(await selected(),'D:\\fixture\\Entry_5.txt');
   await expect(page.locator('.search-result[aria-selected=true]')).toHaveCount(1);
   if(!embedded){await page.locator('.search-result.selected [data-preview]').hover();await expect(page.locator('#one-tooltip.visible')).toHaveText('预览');}
   await page.evaluate(()=>{
    window.savedRows=new Map([...document.querySelectorAll('.search-result')].map(row=>[row.querySelector('[data-file-icon]').dataset.fileIcon,{row,icon:row.querySelector('img'),preview:row.querySelector('[data-preview]')} ]));
    window.removedRows=0;window.tooltipHides=0;
    window.rowObserver=new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n instanceof Element&&n.matches('.search-result'))window.removedRows++;});window.rowObserver.observe(document.querySelector('#search-results'),{childList:true});
    const tip=document.querySelector('#one-tooltip');window.tipObserver=new MutationObserver(()=>{if(!tip.classList.contains('visible'))window.tooltipHides++;});if(tip)window.tipObserver.observe(tip,{attributes:true,attributeFilter:['class']});
   });
   const before=await counts();for(let i=0;i<20;i++){await send();await page.waitForTimeout(20);}await page.waitForTimeout(260);await ready();
   const after=await counts(),stable=await page.evaluate(()=>({removed:window.removedRows,tooltipHides:window.tooltipHides,retained:[...window.savedRows].filter(([path,old])=>{const row=[...document.querySelectorAll('.search-result')].find(e=>e.querySelector('[data-file-icon]').dataset.fileIcon===path);return row===old.row&&row.querySelector('img')===old.icon&&row.querySelector('[data-preview]')===old.preview;}).length}));
   assert.equal(stable.removed,0);assert.equal(stable.retained,100);assert.equal(after.icons,before.icons);assert.equal(await selected(),'D:\\fixture\\Entry_5.txt');assert.ok(after.calls-before.calls<=5);assert.ok(after.calls>before.calls);
   assert.ok((await app.evaluate((_electron,start)=>global.calls.slice(start).every(call=>!call.token),before.calls)),'background refresh should preserve the visible result until complete');
   const settledCalls=after.calls;await send('one:search-state',true);await page.waitForTimeout(240);assert.equal((await counts()).calls,settledCalls,'indexing in progress should not restart a settled search');
   if(!embedded){assert.equal(stable.tooltipHides,0);await expect(page.locator('#one-tooltip.visible')).toHaveText('预览');}
   const context=await page.evaluate(()=>window.one.searchContext());
   await win.evaluate((w,context)=>w.webContents.send('one:search-context',{...context,pid:123,created:'fixture',currentFolder:'D:\\fixture'}),context);
   await page.waitForTimeout(260);await ready();assert.equal(await selected(),'D:\\fixture\\Entry_5.txt');
   await page.mouse.move(4,4);await configure({delay:600,reverse:true});const preReorder=await counts();await send('one:search-files-changed');
   await expect.poll(async()=>(await counts()).calls).toBeGreaterThan(preReorder.calls);
   await page.locator('#file-query').focus();for(let i=0;i<8;i++)await page.keyboard.press('ArrowDown');const chosen=await selected();assert.equal(chosen,'D:\\fixture\\Entry_13.txt');
   const top=await page.locator('.search-result.selected').evaluate(e=>e.getBoundingClientRect().top);
   await ready();assert.equal(await selected(),chosen);assert.equal(await page.locator('.search-result.selected').getAttribute('data-result'),'86');
   const topAfter=await page.locator('.search-result.selected').evaluate(e=>e.getBoundingClientRect().top);assert.ok(Math.abs(topAfter-top)<1,JSON.stringify({top,topAfter}));
   await page.keyboard.press('ArrowDown');assert.equal(await selected(),'D:\\fixture\\Entry_12.txt');
   await page.locator('.search-result.selected').click({button:'right'});
   assert.equal(await app.evaluate(()=>global.actions.at(-1).args[0]),'D:\\fixture\\Entry_12.txt');
   await page.locator('.search-result.selected [data-preview]').evaluate(e=>e.click());
   assert.equal(await app.evaluate(()=>global.actions.at(-1).args[0]),'D:\\fixture\\Entry_12.txt');
   await configure({delay:30,remove:12,version:1});await send('one:search-files-changed');await expect(page.locator('.search-result')).toHaveCount(99);await ready();
   assert.equal(await selected(),'D:\\fixture\\Entry_11.txt');await expect(page.locator('.search-result.selected .result-name>span')).toContainText('v1');
   await page.locator('#file-query').fill('fresh');await ready();await expect(page.locator('.search-result').first()).toContainText('fresh');assert.equal(await page.locator('.search-result.selected').getAttribute('data-result'),'0');assert.equal(await page.locator('#search-results').evaluate(e=>e.scrollTop),0);
   const preSlow=await counts();await page.locator('#file-query').fill('slow');await expect.poll(async()=>(await counts()).calls).toBeGreaterThan(preSlow.calls);
   await page.locator('#file-query').fill('latest');await expect(page.locator('.search-result').first()).toContainText('latest');await page.waitForTimeout(760);await ready();await expect(page.locator('.search-result').first()).toContainText('latest');
   const preComposition=await counts();await page.evaluate(()=>{const e=document.querySelector('#file-query');e.dispatchEvent(new CompositionEvent('compositionstart'));e.value='中文';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
   for(let i=0;i<10;i++)await send();await page.waitForTimeout(260);assert.equal((await counts()).calls,preComposition.calls);
   await page.evaluate(()=>document.querySelector('#file-query').dispatchEvent(new CompositionEvent('compositionend')));await expect(page.locator('.search-result').first()).toContainText('中文');await ready();
   await page.locator('#file-query').fill('canceled');await page.waitForTimeout(200);await ready();await expect(page.locator('.search-result').first()).toContainText('中文');
   await configure({delay:600,reverse:false,remove:-1000});await page.locator('#file-query').fill('burst');const beforeBurst=await counts();
   for(let i=0;i<35;i++){await send();await page.waitForTimeout(20);}await expect(page.locator('.search-result').first()).toContainText('burst');
   await page.waitForTimeout(1500);await ready();const burst=await counts();assert.ok(burst.calls-beforeBurst.calls<=3,JSON.stringify({beforeBurst,burst}));
   if(!embedded){
    const all=page.locator('[data-filter=""]');await expect(page.locator('#search-filters .tabs')).toHaveClass(/segment-ready/);await all.focus();await page.keyboard.press('ArrowRight');await expect(page.locator('[data-filter="app:"]')).toBeFocused();await expect(page.locator('[data-filter="app:"]')).toHaveAttribute('aria-selected','true');
    await ready();await expect(page.locator('[data-preview]')).toHaveCount(0);const actions=(await counts()).actions;await page.keyboard.press('Enter');await page.waitForTimeout(50);assert.equal((await counts()).actions,actions);await page.keyboard.press('Home');await expect(all).toBeFocused();await expect(all).toHaveAttribute('aria-selected','true');
    await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.tabs')).toHaveCSS('overflow-x','auto');assert.equal(await page.locator('.tabs').evaluate(e=>getComputedStyle(e,'::before').transitionDuration),'0s');
   }else{
    const rects=await page.evaluate(()=>({input:document.querySelector('.search-input-row').getBoundingClientRect().toJSON(),list:document.querySelector('#search-results').getBoundingClientRect().toJSON()}));assert.ok(rects.list.bottom<=rects.input.top+1);
    await page.keyboard.press('Control+2');assert.equal(await app.evaluate(()=>global.actions.at(-1).args[0]),'D:\\fixture\\Entry_1.txt');
   }
   await configure({delay:30});await page.locator('#file-query').fill('x_bea');await expect(page.locator('.search-result').first()).toContainText('x_bea');await ready();
   for(const theme of ['light','dark']){await main.evaluate(theme=>window.one.patchSettings({appearance:{mode:theme}}),theme);await page.screenshot({path:path.join(out,(embedded?'inline':'standalone')+'-'+theme+'.png')});}
   await page.evaluate(()=>{window.rowObserver.disconnect();window.tipObserver.disconnect();});
   await win.evaluate(w=>w.hide());await expect.poll(()=>page.evaluate(async()=>(await window.one.windowState()).visible)).toBe(false);await page.waitForTimeout(80);
   const hidden=await counts();for(let i=0;i<10;i++)await send();await page.waitForTimeout(250);assert.equal((await counts()).calls,hidden.calls);
   await win.evaluate(w=>{w.show();w.focus();});await expect.poll(async()=>(await counts()).calls).toBeGreaterThan(hidden.calls);await ready();
   await win.evaluate(w=>w.webContents.send('one:search-reset'));await expect(page.locator('#file-query')).toHaveValue('');await expect(page.locator('[data-filter=""]')).toHaveAttribute('aria-selected','true');
   reports.push({embedded,...stable,backgroundQueries:after.calls-before.calls,extraIconQueries:after.icons-before.icons,inFlightSelection:chosen,scrollAnchorDelta:topAfter-top,burstQueries:burst.calls-beforeBurst.calls});
   await win.evaluate(w=>w.hide());
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({result:'PASS',reports,errors},null,2));console.log(JSON.stringify({result:'PASS',reports},null,2));
 }catch(error){for(const page of app.windows())if(page.url().includes('view=search'))await page.screenshot({path:path.join(out,page.url().includes('embedded')?'failure-inline.png':'failure-standalone.png')}).catch(()=>{});console.error(await app.evaluate(()=>({calls:global.calls,completed:global.completed,actions:global.actions})));throw error;}
 finally{await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
