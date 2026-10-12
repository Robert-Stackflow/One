const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const output=path.resolve('work/current/theme-app');fs.mkdirSync(output,{recursive:true});
for(const [name,entry] of Object.entries({automation:'src/main/theme-automation.ts',settings:'src/shared/settings.ts',shared:'src/shared/theme-schedule.ts'}))buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',outfile:path.join(output,name+'.cjs')});
const {ThemeAutomation}=require(path.join(output,'automation.cjs'));
const {defaultSettings,validateSettings,mergeSettings}=require(path.join(output,'settings.cjs'));
const {defaultThemeSchedule,validateThemeSchedule}=require(path.join(output,'shared.cjs'));
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const ok=(a,m)=>{assert.ok(a,m);checks++;};
async function main(){
 const legacy=defaultSettings();delete legacy.themeSchedule;eq(validateSettings(legacy).themeSchedule,defaultThemeSchedule(),'Legacy settings default to off');
 const p={...defaultThemeSchedule(),enabled:true,latitude:31.2,longitude:121.5,shortcut:'Ctrl+Alt+T',targets:{...defaultThemeSchedule().targets,windowsApps:true}};
 const restored=validateSettings(JSON.parse(JSON.stringify(mergeSettings(defaultSettings(),{themeSchedule:p}))));eq(restored.themeSchedule,p,'Settings roundtrip includes every preference');
 for(const key of ['Space','Home','PageDown','ArrowRight']){eq(validateThemeSchedule({...p,shortcut:'Ctrl+Alt+'+key}).shortcut,'Ctrl+Alt+'+key);}
 let baseline=defaultSettings().appearance,now=new Date(2026,9,10,8),windows={apps:'light',system:'dark',nightLight:undefined,detail:'夜间状态尚未初始化'},readError=false,writeError=false,changes=0,reads=0,stalled=false;
 const writes=[],published=[],registered=new Map();
 const service=new ThemeAutomation({appearance:()=>baseline,systemDark:()=>false,clock:()=>now,changedAppearance:()=>changes++,publish:v=>published.push(v),register:(key,cb)=>{if(registered.has(key))return false;registered.set(key,cb);return true;},unregister:key=>registered.delete(key),windows:{read:async signal=>{reads++;if(stalled)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));if(readError)throw Error('读取失败');return {...windows};},apply:async(mode,targets)=>{if(writeError)throw Error('Windows 范围写入失败');writes.push({mode,targets});if(targets.windowsApps)windows.apps=mode;if(targets.windowsSystem)windows.system=mode;}}});
 try{
  await service.configure(defaultThemeSchedule());eq(reads,0);eq(writes.length,0);eq(service.appearance().mode,'system');
  await service.manual('dark');eq(service.appearance().mode,'dark');eq(baseline.mode,'system','Temporary One mode does not overwrite the baseline');eq(writes.length,0,'One-only never invokes the native helper');eq(service.state().phase,'manual');
  await service.configure({...defaultThemeSchedule(),source:'sun',latitude:31.2,longitude:121.5});eq(service.appearance().mode,'dark','Editing an inactive plan preserves a manual One theme');eq(service.state().phase,'manual');
  await service.resume();eq(service.appearance().mode,'system');eq(service.state().phase,'off');
  await service.configure(p);eq(service.appearance().mode,'light');eq(windows.apps,'light');eq(windows.system,'dark','Unselected system interface stays unchanged');
  await service.manual('dark');eq(windows.apps,'dark');eq(service.state().phase,'manual');
  const windowsOnly={...p,targets:{...p.targets,one:false}};
  await service.configure(windowsOnly);eq(service.appearance().mode,'system');eq(windows.apps,'dark','Leaving One management preserves the Windows manual theme');eq(service.state().phase,'manual');
  const before=writes.length;await service.configure({...windowsOnly,shortcut:'Ctrl+Alt+Y'});eq(service.state().phase,'manual');eq(writes.length,before,'Changing a hotkey never reapplies Windows themes');
  service.registerShortcut('Ctrl+Alt+Y');eq(service.state().shortcutActive,true);ok(registered.has('Control+Alt+Y'));
  service.pauseShortcut();eq(registered.size,0);eq(service.state().shortcutActive,false);
  service.registerShortcut('Ctrl+Alt+Y');registered.set('Control+Alt+Z',()=>{});assert.throws(()=>service.registerShortcut('Ctrl+Alt+Z'),/占用/);checks++;eq(service.state().shortcutActive,false);ok(service.state().shortcutError.includes('占用'));
  service.registerShortcut('Ctrl+Alt+Y');eq(service.state().shortcutError,'');
  registered.get('Control+Alt+Y')();await service.sync();eq(windows.apps,'light','Hotkey toggles selected Windows scope');
  await service.manual('dark');now=new Date(2026,9,10,19,1);await service.sync();eq(service.state().phase,'automatic');eq(windows.apps,'dark','Missed boundary resumes the plan');
  now=new Date(2026,9,11,8);await service.sync();eq(windows.apps,'light','Wake synchronization catches the next day');
  await service.configure({...p,source:'night-light'});eq(service.state().phase,'unavailable');eq(service.state().detail,'夜间状态尚未初始化');
  await service.manual('dark');eq(service.state().phase,'manual');windows.nightLight=false;await service.sync();eq(service.appearance().mode,'dark','Unknown Night Light recovery preserves manual intent');windows.nightLight=true;await service.sync();eq(service.state().phase,'automatic');
  await service.configure({...p,source:'sun',latitude:null,longitude:null});eq(service.state().phase,'unavailable');
  await service.configure(windowsOnly);readError=true;await service.manual('toggle');eq(service.state().phase,'error');ok(service.state().detail.includes('读取失败'));readError=false;await service.resume();eq(service.state().phase,'automatic');
  writeError=true;await service.manual('dark');eq(service.state().phase,'error');writeError=false;await service.sync();eq(service.state().phase,'manual');eq(windows.apps,'dark');
  const snapshot=service.state();snapshot.preferences.targets.windowsSystem=true;eq(service.state().preferences.targets.windowsSystem,false,'Status does not expose mutable preferences');
  await service.configure({...p,source:'night-light'});stalled=true;const pending=service.sync();await new Promise(setImmediate);const count=published.length;service.stop();await pending;eq(published.length,count,'No late state after shutdown');eq(registered.has('Control+Alt+Y'),false,'Shutdown unregisters only the owned hotkey');ok(changes>0);
 }finally{service.stop();}
 const report={result:'PASS',checks,scope:'Settings migration/roundtrip, temporary One appearance, scope changes, hotkeys, Night Light recovery, wake catch-up, failure and shutdown with injected Windows/shortcut adapters; no real Windows writes.'};fs.writeFileSync(path.join(output,'automation-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
