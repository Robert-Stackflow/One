const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {buildSync}=require('esbuild');
const output=path.resolve(process.env.ONE_THEME_OUTPUT_DIR||'work/current/theme-schedule');fs.mkdirSync(output,{recursive:true});
const files={shared:'src/shared/theme-schedule.ts',service:'src/main/theme-schedule-service.ts'};
function bundle(){for(const [name,entry] of Object.entries(files))buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',outfile:path.join(output,name+'.cjs')});}
let checks=0;
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const check=(value,message)=>{assert.ok(value,message);checks++;};
const barrier=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

async function timezoneCases(){
 const {defaultThemeSchedule,evaluateThemeSchedule}=require(path.join(output,'shared.cjs'));
 const p={...defaultThemeSchedule(),enabled:true};
 const local=(day,time)=>new Date(`${day}T${time}:00`);
 equal(evaluateThemeSchedule(p,local('2026-10-10','06:59')).mode,'dark');
 equal(evaluateThemeSchedule(p,local('2026-10-10','07:00')).mode,'light');
 equal(evaluateThemeSchedule(p,local('2026-10-10','18:59')).mode,'light');
 equal(evaluateThemeSchedule(p,local('2026-10-10','19:00')).mode,'dark');
 equal(evaluateThemeSchedule({...p,lightAt:'20:00',darkAt:'08:00'},local('2026-10-10','01:00')).mode,'light','Inverted schedules cross midnight correctly');
 equal(evaluateThemeSchedule({...p,lightAt:'20:00',darkAt:'08:00'},local('2026-10-10','12:00')).mode,'dark');
 for(const date of ['2026-03-08','2026-11-01','2024-02-29']){
  const now=local(date,'18:59'),plan=evaluateThemeSchedule(p,now);
  equal(plan.next.at,local(date,'19:00').getTime());check(plan.next.at>now.getTime());
 }
 if(process.env.TZ==='America/New_York'){
  const gap={...p,lightAt:'02:30',darkAt:'22:00'};
  equal(evaluateThemeSchedule(gap,new Date('2026-03-08T07:29:00Z')).mode,'dark');
  equal(evaluateThemeSchedule(gap,new Date('2026-03-08T07:30:00Z')).mode,'light','Missing DST hour advances to valid local time');
  const fold={...p,lightAt:'01:30',darkAt:'22:00'};
  equal(evaluateThemeSchedule(fold,new Date('2026-11-01T05:30:00Z')).mode,'light');
  equal(evaluateThemeSchedule(fold,new Date('2026-11-01T06:15:00Z')).mode,'light','Repeated hour does not undo an applied boundary');
 }
 console.log(JSON.stringify({timezone:process.env.TZ,checks}));
}
async function main(){
 bundle();
 const {defaultThemeSchedule,validateThemeSchedule,evaluateThemeSchedule,solarDay}=require(path.join(output,'shared.cjs'));
 const {ThemeScheduleService}=require(path.join(output,'service.cjs'));
 equal(defaultThemeSchedule().enabled,false);equal(defaultThemeSchedule().targets,{one:true,windowsApps:false,windowsSystem:false,manageStartTaskbarAccent:false,startTaskbarAccentLight:false,startTaskbarAccentDark:true,manageTitleBarAccent:false,titleBarAccentLight:false,titleBarAccentDark:true});
 equal(validateThemeSchedule(undefined),defaultThemeSchedule());
 equal(validateThemeSchedule({...defaultThemeSchedule(),targets:{one:true,windowsApps:false,windowsSystem:false}}).targets,defaultThemeSchedule().targets,'Older settings keep Windows accent controls unmanaged');
 for(const patch of [{lightAt:'25:00'},{darkAt:'07:00'},{latitude:100,longitude:0},{latitude:0},{latitude:null,longitude:0},{sunsetOffset:181},{source:'bad'},{targets:{one:false,windowsApps:false,windowsSystem:false,other:true}},{shortcut:'A'},{shortcut:'Ctrl+Something'}]){
  assert.throws(()=>validateThemeSchedule({...defaultThemeSchedule(),...patch}));checks++;
 }
 const p={...defaultThemeSchedule(),enabled:true};
 equal(evaluateThemeSchedule({...p,enabled:false}).phase,'off');
 equal(evaluateThemeSchedule({...p,source:'sun'}).phase,'unavailable');
 equal(evaluateThemeSchedule({...p,source:'night-light'},new Date(),undefined).phase,'unavailable');
 equal(evaluateThemeSchedule({...p,source:'night-light'},new Date(),true).mode,'dark');
 equal(evaluateThemeSchedule({...p,source:'night-light'},new Date(),false).mode,'light');
 const fixture=JSON.parse(fs.readFileSync('tests/fixtures/theme-solar-reference.json','utf8'));let maxSolarErrorMs=0;
 for(const sample of fixture.cases){
  const [year,month,date]=sample.date.split('-').map(Number),actual=solarDay(year,month,date,sample.latitude,sample.longitude);
  for(const key of ['sunrise','sunset'])if(sample[key]!==null){const error=Math.abs(actual[key]-sample[key]);maxSolarErrorMs=Math.max(maxSolarErrorMs,error);check(error<10*60000,`Solar reference ${sample.date} ${sample.latitude}, ${sample.longitude} ${key}: ${error/60000} minutes`);}
 }
 equal(solarDay(2026,6,21,80,0).kind,'polar-day');equal(solarDay(2026,12,21,80,0).kind,'polar-night');
 assert.throws(()=>solarDay(2026,2,29,0,0));checks++;
 const solar={...p,source:'sun',latitude:39.9,longitude:116.4};
 const day=solarDay(2026,10,10,39.9,116.4);
 equal(evaluateThemeSchedule(solar,new Date(day.sunrise)).mode,'light');
 equal(evaluateThemeSchedule(solar,new Date(day.sunset)).mode,'dark');
 const shifted={...solar,sunriseOffset:30,sunsetOffset:-30};
 equal(evaluateThemeSchedule(shifted,new Date(day.sunrise+29*60000)).mode,'dark');
 equal(evaluateThemeSchedule(shifted,new Date(day.sunrise+30*60000)).mode,'light');
 equal(evaluateThemeSchedule(shifted,new Date(day.sunset-30*60000)).mode,'dark');
 const polar={...p,source:'sun',latitude:80,longitude:0};
 const june=evaluateThemeSchedule(polar,new Date('2026-06-10T12:00:00Z')),july=evaluateThemeSchedule(polar,new Date('2026-07-10T12:00:00Z'));
 equal(june.mode,'light');equal(july.mode,'light');equal(june.token,july.token,'Polar manual override persists until a real transition');check(june.next.at>Date.parse('2026-07-10T12:00:00Z'));
 let now=new Date('2026-10-10T08:00:00'),night=false,current='light',writes=[],published=[],released=0;
 let readNight=async()=>night,applyGate,readGate,applyError=false;
 const service=new ThemeScheduleService({clock:()=>now,nightLight:signal=>readNight(signal),currentMode:async()=>{if(readGate)await readGate.promise;return current;},apply:async(mode,targets)=>{if(applyGate)await applyGate.promise;if(applyError)throw Error('Theme write failed');current=mode;writes.push({mode,targets});},release:async()=>{released++;},publish:value=>published.push(value)});
 try{
  await service.configure(defaultThemeSchedule());equal(writes.length,0);check(released>0,'Disabled automation releases One override');
  await service.configure(p);equal(current,'light');const first=writes.length;
  await Promise.all([service.sync(),service.sync(),service.sync()]);equal(writes.length,first,'Repeated ticks do not reapply');
  await service.manual('dark');equal(current,'dark');equal(service.state().phase,'manual');
  now=new Date('2026-10-10T10:00:00');await service.sync();equal(current,'dark');equal(service.state().phase,'manual');
  now=new Date('2026-10-10T20:00:00');await service.sync();equal(service.state().phase,'automatic');equal(current,'dark','Wake after a missed boundary catches up');
  now=new Date('2026-10-11T08:00:00');await service.sync();equal(current,'light');
  await Promise.all([service.manual('toggle'),service.manual('toggle')]);equal(current,'light','Two rapid toggles are serialized, not silently collapsed');
  readGate=barrier();const toggling=service.manual('toggle');await turn();now=new Date('2026-10-11T20:00:00');readGate.resolve();await toggling;readGate=undefined;equal(service.state().phase,'manual');await service.sync();equal(service.state().phase,'manual','Manual baseline uses time after async current-theme lookup');
  await service.resumeSchedule();equal(service.state().phase,'automatic');equal(current,'dark');
  await service.configure({...p,source:'night-light'});equal(current,'light');
  await service.manual('dark');equal(service.state().phase,'manual');night=undefined;await service.sync();equal(current,'dark','Unavailable night state preserves manual theme');night=false;await service.sync();equal(service.state().phase,'manual');night=true;await service.sync();equal(service.state().phase,'automatic');equal(current,'dark');
  night=undefined;await service.manual('light');equal(current,'light','Manual switching works when the automatic source is unavailable');night=true;await service.sync();equal(service.state().phase,'manual','First available night state establishes a baseline without discarding the override');night=false;await service.sync();equal(service.state().phase,'automatic');
  await service.configure({...p,source:'sun'});equal(service.state().phase,'unavailable');const before=writes.length;await service.sync();equal(writes.length,before,'Missing location does not change the theme');
  await service.manual('dark');equal(current,'dark');
  now=new Date('2026-10-11T08:00:00');applyGate=barrier();const old=service.configure(p);await turn();const latest=service.configure({...p,lightAt:'12:00'});applyGate.resolve();await Promise.all([old,latest]);applyGate=undefined;equal(current,'dark','Latest config wins over an in-flight application');
  const scoped={...p,targets:{...p.targets,one:false,windowsApps:true}};await service.configure(scoped);equal(writes.at(-1).targets,scoped.targets);scoped.targets.windowsSystem=true;await service.sync();equal(writes.at(-1).targets.windowsSystem,false,'Caller mutation cannot widen the write scope');
  const beforeError=writes.length;readNight=async()=>{throw Error('Night state unavailable');};await service.configure({...p,source:'night-light'});equal(service.state().phase,'unavailable');equal(writes.length,beforeError);await service.manual('dark');equal(current,'dark','Read exceptions cannot block explicit manual switching');
  await service.resumeSchedule();
  readNight=async()=>false;await service.sync();equal(service.state().phase,'automatic');equal(current,'light','Source recovers without restart');
  applyError=true;await service.manual('dark');equal(service.state().phase,'error');equal(current,'light','Failed application cannot be reported as a completed theme change');applyError=false;await service.sync();equal(current,'dark');equal(service.state().phase,'manual','Apply failure can recover while retaining manual intent');
  let aborted=false;readNight=signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
  const stopping=service.sync();await turn();const publishedBefore=published.length;service.stop();await stopping;check(aborted);equal(published.length,publishedBefore,'No progress after stop');
  await assert.rejects(service.manual('toggle'),/已关闭/);checks++;
 }finally{service.stop();}
 const timezones=[];
 for(const tz of ['UTC','Asia/Shanghai','America/New_York','Pacific/Auckland']){
  const child=cp.spawnSync(process.execPath,[__filename,'--timezone'],{env:{...process.env,TZ:tz},encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);const report=JSON.parse(child.stdout.trim());checks+=report.checks;timezones.push(report);
 }
 const report={result:'PASS',checks,solarReferenceCases:fixture.cases.length,maxSolarErrorMinutes:Math.round(maxSolarErrorMs/600)/100,timezones,scope:'Schedule engine/controller only; UI, native Windows bridge and app lifecycle not integrated yet'};
 fs.writeFileSync(path.join(output,'engine-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
(process.argv.includes('--timezone')?timezoneCases():main()).catch(error=>{console.error(error);process.exitCode=1;});
