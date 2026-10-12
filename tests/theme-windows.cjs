const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {buildSync}=require('esbuild');
const folder=path.resolve('work/current/theme-schedule');
for(const [name,entry] of [['night-light','src/main/night-light.ts'],['theme-windows','src/main/theme-windows.ts']])buildSync({entryPoints:[entry],bundle:true,platform:'node',outfile:path.join(folder,name+'.cjs')});
const {parseNightLight}=require(path.join(folder,'night-light.cjs')),{WindowsThemeBridge}=require(path.join(folder,'theme-windows.cjs'));
let checks=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;},check=(a,msg)=>{assert.ok(a,msg);checks++;};
const variable=value=>{let n=BigInt(value),result=[];do{let byte=Number(n&127n);n>>=7n;if(n)byte|=128;result.push(byte);}while(n);return Buffer.from(result);};
const header=(type,id)=>Buffer.from(id<6?[type|id<<5]:id<256?[type|192,id]:[type|224,id&255,id>>8]);
const field=(type,id,data)=>Buffer.concat([header(type,id),Buffer.from(data)]);
const magic=Buffer.from('43420100','hex'),stop=Buffer.from([0]);
const innerOff=Buffer.from('43420100d00a02c614b09fd1e6f89fafee0100','hex'); // Published state example, 2026-03-26.
const innerOn=Buffer.concat([magic,field(16,0,[0]),innerOff.subarray(4)]);
function envelope(inner,timestamp=1n,extra=Buffer.alloc(0)){
 return Buffer.concat([magic,field(10,0,Buffer.from([2,1,0])),field(10,1,Buffer.concat([field(6,0,variable(timestamp)),field(10,1,Buffer.concat([field(11,1,Buffer.concat([Buffer.from([14]),variable(inner.length),inner])),stop])),stop])),extra,stop]);
}
const run=(exe,args)=>cp.execFileSync(exe,args,{windowsHide:true,encoding:'utf8',timeout:10000});
async function main(){
 for(const timestamp of [0n,127n,128n,0xffffffffn,0xffffffffffffffffn]){eq(parseNightLight(envelope(innerOn,timestamp)).active,true);eq(parseNightLight(envelope(innerOff,timestamp)).active,false);}
 const unknown=Buffer.concat([field(9,41,Buffer.concat([variable(3),Buffer.from('abc')])),field(8,700,Buffer.alloc(8)),field(11,52,Buffer.from([16,3,0,2,4])),field(13,53,Buffer.from([9,16,1,1,120,0]))]);
 eq(parseNightLight(envelope(Buffer.concat([magic,unknown,innerOn.subarray(4)]))).active,true,'Unknown legal fields are skipped with bounded work');
 eq(parseNightLight(envelope(Buffer.concat([magic,field(16,0,[0]),field(2,30,[0]),stop]))).active,undefined,'Unsupported device is not treated as off');
 for(const bad of [Buffer.concat([magic,field(2,0,[0]),stop]),Buffer.concat([magic,field(6,0,[0]),stop]),Buffer.concat([magic,field(16,0,[2]),stop]),Buffer.concat([magic,field(16,0,[0]),field(16,0,[0]),stop]),Buffer.concat([Buffer.from('43420200','hex'),stop])])eq(parseNightLight(envelope(bad)).active,undefined);
 const valid=envelope(innerOn);for(let length=0;length<valid.length;length++)eq(parseNightLight(valid.subarray(0,length)).active,undefined,'Truncation must never become off');
 for(const data of [Buffer.concat([valid,stop]),Buffer.alloc(65537),Buffer.from('434201000a0201002a06000000','hex'),envelope(Buffer.concat([magic,field(11,90,Buffer.concat([Buffer.from([14]),variable(65536)])),stop]))])eq(parseNightLight(data).active,undefined);
 for(const [depth,expected] of [[7,true],[8,undefined]]){let nested=stop;for(let n=0;n<depth;n++)nested=Buffer.concat([field(10,99,nested),stop]);eq(parseNightLight(envelope(Buffer.concat([magic,field(16,0,[0]),field(10,99,nested),stop]))).active,expected,'Empty structs obey the same depth budget');}
 for(const [count,expected] of [[4095,true],[4096,undefined]]){const fields=Array.from({length:count},(_,index)=>field(5,index+100,[0]));eq(parseNightLight(envelope(Buffer.concat([magic,field(16,0,[0]),...fields,stop]))).active,expected,'Field budget is enforced before allocating unbounded maps');}
 for(const [value,expected] of [[65535,true],[65536,undefined]])eq(parseNightLight(envelope(Buffer.concat([magic,field(16,0,[0]),field(4,50,variable(value)),stop]))).active,expected,'Unknown integer fields still obey their declared width');
 eq(parseNightLight(envelope(Buffer.concat([magic,field(16,0,[0]),field(13,50,[0,0,0]),stop]))).active,undefined,'Invalid empty-map element types cannot bypass validation');
 const helper=path.join(folder,'native-build/One.Theme.Test.exe'),id=`scope-${process.pid}-${Date.now()}`,root=`HKCU\\Software\\One.ThemeTests\\${id}`;
 const bridge=new WindowsThemeBridge(helper,['--test-id',id]),signal=new AbortController().signal;
 const native=args=>JSON.parse(run(helper,[...args,'--test-id',id]));
 const setData=data=>{
  const fixture=path.join(folder,'night-fixture.bin');fs.writeFileSync(fixture,data);
  const script=path.join(folder,'set-fixture.ps1');fs.writeFileSync(script,`$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\One.ThemeTests\\${id}\\NightState')\ntry{$key.SetValue('Data',[IO.File]::ReadAllBytes('${fixture.replace(/'/g,"''")}'),[Microsoft.Win32.RegistryValueKind]::Binary)}finally{$key.Dispose()}\n`);
  run('powershell.exe',['-NoProfile','-NonInteractive','-File',script]);
 };
 try{
  let state=await bridge.read(signal);eq(state.apps,undefined);eq(state.nightLight,undefined);check(!!state.detail);
  const target={windowsApps:false,windowsSystem:false,manageStartTaskbarAccent:false,startTaskbarAccentLight:false,startTaskbarAccentDark:true,manageTitleBarAccent:false,titleBarAccentLight:false,titleBarAccentDark:true};
  await bridge.apply('dark',{...target,windowsApps:true},signal);state=await bridge.read(signal);eq(state.apps,'dark');eq(state.system,undefined,'Apps-only does not create the system theme value');
  await bridge.apply('light',{...target,windowsSystem:true},signal);state=await bridge.read(signal);eq(state.apps,'dark');eq(state.system,'light','System-only leaves apps untouched');
  await bridge.apply('light',{...target,windowsApps:true,windowsSystem:true},signal);state=await bridge.read(signal);eq([state.apps,state.system],['light','light']);
  await bridge.apply('dark',target,signal);state=await bridge.read(signal);eq([state.apps,state.system],['light','light'],'Empty Windows scope is a no-op');
  const registryValue=(subkey)=>{const result=cp.spawnSync('reg.exe',['query',root+'\\'+subkey,'/v','ColorPrevalence'],{windowsHide:true,encoding:'utf8'});return result.status===0?Number.parseInt(result.stdout.match(/REG_DWORD\s+0x([0-9a-f]+)/i)?.[1]||'',16):undefined;};
  eq(registryValue('Personalize'),undefined,'Default does not manage Start/taskbar accent');
  eq(registryValue('DWM'),undefined,'Default does not manage title bar accent');
  await bridge.apply('dark',{...target,windowsSystem:true,manageStartTaskbarAccent:true,manageTitleBarAccent:true},signal);
  eq(registryValue('Personalize'),1,'Dark mode enables Start/taskbar accent');eq(registryValue('DWM'),1,'Dark title bar preference enables accent');
  await bridge.apply('light',{...target,windowsSystem:true,manageStartTaskbarAccent:true,manageTitleBarAccent:true},signal);
  eq(registryValue('Personalize'),0,'Light Start/taskbar preference disables accent');eq(registryValue('DWM'),0,'Light title bar preference disables accent');
  await bridge.apply('light',{...target,windowsSystem:true,manageStartTaskbarAccent:true,startTaskbarAccentLight:true,manageTitleBarAccent:true,titleBarAccentLight:true},signal);
  eq(registryValue('Personalize'),1,'Light Start/taskbar preference can force accent on');
  eq(registryValue('DWM'),1,'Light title bar preference can enable accent');
  await bridge.apply('dark',{...target,windowsSystem:true,manageStartTaskbarAccent:true,startTaskbarAccentDark:false,manageTitleBarAccent:true,titleBarAccentDark:false},signal);
  eq(registryValue('Personalize'),0,'Dark Start/taskbar preference can disable accent');
  eq(registryValue('DWM'),0,'Dark title bar preference can disable accent');
  eq(cp.spawnSync(helper,['apply','light','apps','start-on','--test-id',id],{windowsHide:true}).status,2,'Accent options require system scope');
  const invalid=cp.spawnSync(helper,['apply','invalid','both','--test-id',id],{windowsHide:true,encoding:'utf8'});eq(invalid.status,2);eq(native(['read']).apps,'light');
  for(const [data,expected] of [[envelope(innerOn),true],[envelope(innerOff),false],[Buffer.from('434201000a0201002a06000000','hex'),undefined]]){setData(data);state=await bridge.read(signal);eq(state.nightLight,expected);}
  setData(Buffer.alloc(65537));const bounded=native(['read']);eq(bounded.nightError,234);eq(bounded.nightData,'','Oversized native values never enter JSON');
  const production=cp.spawnSync(path.resolve('dist/native/One.Theme.exe'),['read','--test-id',id],{windowsHide:true,encoding:'utf8'});eq(production.status,2,'Production helper cannot redirect registry access');
  const actual=JSON.parse(run(path.resolve('dist/native/One.Theme.exe'),['read']));check(actual.apps===null||['light','dark'].includes(actual.apps));check(actual.system===null||['light','dark'].includes(actual.system));
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(bridge.read(cancelled.signal));checks++;
  const config=JSON.parse(fs.readFileSync('package.json','utf8'));check(config.build.files.includes('dist/**/*')&&config.build.asarUnpack.includes('dist/native/One.Theme.exe'),'Production helper is included and executable outside asar');check(!config.build.asarUnpack.includes('dist/native/One.Theme.Test.exe')&&!fs.existsSync('dist/native/One.Theme.Test.exe'));
  const report={result:'PASS',checks,scope:'Isolated HKCU test root; production read-only. Windows writes and notifications on the user desktop were not exercised.',nightFormat:'Bond CompactBinary v1 envelope and inner schema',productionNightInitialized:actual.nightError===0&&parseNightLight(Buffer.from(actual.nightData,'hex')).active!==undefined};
  fs.writeFileSync(path.join(folder,'windows-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{run('reg.exe',['delete',root,'/f']);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
