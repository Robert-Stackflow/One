const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(process.env.ONE_THEME_UI_OUTPUT_DIR||'work/current/theme-app/ui');
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
async function main(){
 await fs.mkdir(output,{recursive:true});const profile=await fs.mkdtemp(path.join(output,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_THEME_LOCATION:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const launch=()=>electron.launch({args:[path.resolve('.')],env,timeout:30000});
 let app=await launch();
 const disableLocation=()=>app.evaluate(()=>{globalThis.oneTestThemeLocation.port=()=>({begin:()=>0,poll:()=>0,cancel:()=>{}});});await disableLocation();
 try{
  let page=await app.firstWindow();const failures=[];page.on('pageerror',error=>failures.push(error.message));
  const open=async()=>{await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=theme]').click();await expect(page.locator('#theme-fields')).toBeEnabled();};
  await open();
  const settle=async()=>{await page.locator('#theme-sync').click();await expect(page.locator('#theme-schedule')).toHaveAttribute('aria-busy','false');};
  const pick=async(id,value)=>{await page.locator('#'+id).click();const popup=page.locator('#'+id+'-popup'),parts=value.split(':');await popup.locator('[data-part="0"][data-time-value="'+parts[0]+'"]').click();await popup.locator('[data-part="1"][data-time-value="'+parts[1]+'"]').click();await page.keyboard.press('Escape');};
  eq(await page.locator('#theme-save').count(),0,'No save button');eq(await page.locator('#theme-schedule input[type=time]').count(),0,'No native time input');
  await page.locator('#theme-lightAt').focus();await page.keyboard.press('ArrowDown');await expect(page.locator('#theme-lightAt-popup')).toBeVisible();await page.keyboard.press('End');await page.keyboard.press('ArrowRight');await page.keyboard.press('Home');await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>window.one.settings().then(s=>s.themeSchedule.lightAt))).toBe('23:00');checks++;await settle();eq((await page.evaluate(()=>window.one.settings())).themeSchedule.lightAt,'23:00','Custom picker keyboard selection persists automatically');
  eq(await page.locator('[data-theme-source=fixed]').evaluate(e=>getComputedStyle(e).borderBottomWidth),'0px','Last visible plan row has no extra divider');
  const shot=async name=>{const clip=await page.evaluate(()=>({x:260,y:55,width:innerWidth-260,height:innerHeight-55}));await page.screenshot({path:path.join(output,name),clip});};
eq(await page.locator('#theme-enabled').isChecked(),false);eq(await page.locator('#theme-source').getAttribute('role'),'combobox','Uses the existing custom dropdown');
  eq(await page.locator('#theme-schedule select').count(),0,'No native selection control remains');
  const initial=await page.evaluate(()=>window.one.settings());eq(initial.themeSchedule.targets,{one:true,windowsApps:false,windowsSystem:false,manageStartTaskbarAccent:false,startTaskbarAccentLight:false,startTaskbarAccentDark:true,manageTitleBarAccent:false,titleBarAccentLight:false,titleBarAccentDark:true});
  await expect(page.locator('#theme-manageStartTaskbarAccent')).toBeDisabled();await expect(page.locator('#theme-manageTitleBarAccent')).toBeDisabled();
  await page.locator('#theme-windowsSystem').check();await expect(page.locator('#theme-manageStartTaskbarAccent')).toBeEnabled();await expect(page.locator('#theme-manageTitleBarAccent')).toBeEnabled();
  await page.locator('#theme-manageStartTaskbarAccent').check();await expect(page.locator('#theme-startTaskbarAccentLight')).toBeEnabled();await expect(page.locator('#theme-startTaskbarAccentDark')).toBeEnabled();
  await page.locator('#theme-manageTitleBarAccent').check();await expect(page.locator('#theme-titleBarAccentLight')).toBeEnabled();await expect(page.locator('#theme-titleBarAccentDark')).toBeEnabled();
  await page.locator('#theme-startTaskbarAccentLight').check();await page.locator('#theme-titleBarAccentLight').check();await settle();
  eq((await page.evaluate(()=>window.one.settings())).themeSchedule.targets,{one:true,windowsApps:false,windowsSystem:true,manageStartTaskbarAccent:true,startTaskbarAccentLight:true,startTaskbarAccentDark:true,manageTitleBarAccent:true,titleBarAccentLight:true,titleBarAccentDark:true},'Accent choices save automatically');
  await page.locator('#theme-windowsSystem').uncheck();await settle();await expect(page.locator('#theme-manageStartTaskbarAccent')).toBeDisabled();
  const times=await page.evaluate(()=>{const d=new Date(),mins=d.getHours()*60+d.getMinutes(),fmt=n=>`${String(Math.floor((n+1440)%1440/60)).padStart(2,'0')}:${String((n+1440)%60).padStart(2,'0')}`;return {light:fmt(mins-360),dark:fmt(mins+360)};});
  await pick('theme-lightAt',times.light);await pick('theme-darkAt',times.dark);await page.locator('#theme-enabled').check();await expect.poll(()=>page.evaluate(()=>window.one.settings().then(s=>s.themeSchedule.enabled))).toBe(true);await settle();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('#theme-next')).toContainText('下次');
  eq((await page.evaluate(()=>window.one.settings())).appearance.mode,initial.appearance.mode,'Automated One theme preserves the saved appearance preference');
  await page.locator('#theme-dark').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');eq((await page.evaluate(()=>window.one.themeStatus())).phase,'manual');
  const sample=path.join(output,'sample.txt');await fs.writeFile(sample,'Theme appearance preview\n');
  const previewReady=app.waitForEvent('window');await page.evaluate(file=>window.one.preview(file),sample);const preview=await previewReady;await preview.waitForLoadState('domcontentloaded');await expect(preview.locator('html')).toHaveAttribute('data-theme','dark');checks++;
  await page.locator('#theme-resume').click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(preview.locator('html')).toHaveAttribute('data-theme','light');checks++;await preview.close();
  await page.locator('[data-settings-tab=appearance]').click();await page.locator('[data-mode=dark]').click();await page.locator('[data-settings-tab=theme]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('#theme-enabled')).not.toBeChecked();
  eq((await page.evaluate(()=>window.one.settings())).themeSchedule.enabled,false,'One manual mode exits One-only automation');
  const choose=async name=>{await page.locator('#theme-source').click();await page.getByRole('option',{name,exact:true}).click();};
  await choose('日出日落');await expect.poll(()=>page.evaluate(()=>window.one.settings().then(s=>s.themeSchedule.source))).toBe('sun');checks++;await expect(page.locator('#theme-latitude')).toBeVisible();await expect(page.locator('#theme-lightAt')).toBeHidden();
  await settle();eq((await page.evaluate(()=>window.one.settings())).themeSchedule.source,'sun','Source changes persist automatically');
  await page.locator('#theme-latitude').fill('31.2');await settle();await expect(page.locator('#theme-error')).toContainText('同时填写');eq(await page.locator('#theme-latitude').inputValue(),'31.2','Validation preserves input');
  await page.locator('#theme-longitude').fill('121.5');await expect.poll(()=>page.evaluate(()=>window.one.settings().then(s=>s.themeSchedule.longitude))).toBe(121.5);checks++;await page.locator('#theme-sunriseOffset').fill('-15');await page.locator('#theme-sunsetOffset').fill('20');await page.locator('#theme-enabled').check();await settle();
  await expect(page.locator('#theme-next')).toContainText('下次');const solar=await page.evaluate(()=>window.one.settings());eq([solar.themeSchedule.latitude,solar.themeSchedule.longitude,solar.themeSchedule.sunriseOffset,solar.themeSchedule.sunsetOffset],[31.2,121.5,-15,20]);
  await choose('Windows 夜间模式');await settle();const night=await page.evaluate(()=>window.one.themeSync());assert.ok(['automatic','unavailable'].includes(night.phase));checks++;
  if(night.phase==='unavailable'){
    await expect(page.locator('#theme-status')).not.toHaveText('');
    await page.evaluate(()=>{window.themeActionStates=[];for(const id of ['theme-light','theme-dark','theme-resume','theme-sync']){const button=document.getElementById(id);new MutationObserver(()=>window.themeActionStates.push({id,disabled:button.disabled})).observe(button,{attributes:true,attributeFilter:['disabled']});}});
    await page.locator('#theme-dark').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(page.locator('#theme-schedule')).toHaveAttribute('aria-busy','false');
    const states=await page.evaluate(()=>window.themeActionStates);
    for(const id of ['theme-light','theme-dark','theme-resume','theme-sync'])eq(states.filter(state=>state.id===id).map(state=>state.disabled),[true,false],`${id} disabled during manual switch`);
    eq((await page.evaluate(()=>window.one.themeStatus())).phase,'manual');
  }
  await choose('固定时间');await settle();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  // Native recording must pause theme hotkeys and restore them after release.
  await page.locator('#theme-shortcut').focus();await page.keyboard.press('Control+Alt+F9');await page.locator('#theme-status').click();await expect(page.locator('#theme-shortcut')).toHaveValue('Ctrl+Alt+F9');await expect.poll(()=>page.evaluate(()=>window.one.themeStatus().then(s=>s.shortcutActive))).toBe(true);checks++;
  await settle();await expect.poll(()=>page.evaluate(()=>window.one.themeStatus().then(s=>s.shortcutActive))).toBe(true);checks++;
  await page.locator('#theme-shortcut').focus();eq(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+F9')),false,'Hotkey is paused during capture');await page.keyboard.press('Escape');await page.locator('#theme-status').click();await expect.poll(()=>app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+F9'))).toBe(true);checks++;
  await page.evaluate(()=>window.one.themeManual('dark'));await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));eq((await page.evaluate(()=>window.one.themeStatus())).phase,'manual','Wake keeps the current manual interval');
  await page.locator('#theme-resume').click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.evaluate(async()=>{const input=document.querySelector('#theme-enabled');for(let n=0;n<12;n++){input.checked=n%2===0;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,12));}input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});await expect.poll(()=>page.evaluate(()=>window.one.settings().then(s=>s.themeSchedule.enabled))).toBe(true);checks++;await settle();
  const wide=await page.evaluate(()=>{const r=document.querySelector('#theme-schedule').getBoundingClientRect();return {viewport:innerWidth,left:r.left,right:r.right,overflow:document.querySelector('.settings-panels').scrollWidth>document.querySelector('.settings-panels').clientWidth+1};});eq(wide.overflow,false,'Wide layout fits its panel');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'))?.setSize(1000,850));
  await choose('日出日落');const narrow=await page.evaluate(()=>{const panel=document.querySelector('.settings-panels');return {width:innerWidth,overflow:panel.scrollWidth>panel.clientWidth+1};});eq(narrow.overflow,false,'Narrow layout fits its panel');
  await choose('固定时间');await settle();const persisted=await page.evaluate(()=>window.one.settings());
  // Quit normally, retaining the isolated profile for restart acceptance.
  await app.close();app=await launch();await disableLocation();page=await app.firstWindow();await page.waitForSelector('[data-page=settings]');await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=theme]').click();await expect(page.locator('#theme-fields')).toBeEnabled();
  eq((await page.evaluate(()=>window.one.settings())).themeSchedule,persisted.themeSchedule,'All schedule preferences survive restart');await expect(page.locator('html')).toHaveAttribute('data-theme','light');eq((await page.evaluate(()=>window.one.themeStatus())).phase,'automatic','Restart re-evaluates the schedule without persisting a temporary override');
  eq(failures,[],'No renderer exceptions');
  const report={result:'PASS',checks,wide,narrow,nightPhase:night.phase,profile,scope:'Isolated Electron profile; One-only changes, automatic persistence, custom time picker keyboard/mouse, visible dividers, form validation/custom select, preview appearance, native hotkey recording, wake event and restart. Windows themes were not written.'};await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close().catch(()=>{});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
