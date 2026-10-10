const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{buildSync}=require('esbuild');
const output=path.resolve('work/current/theme-location');fs.mkdirSync(output,{recursive:true});
for(const [name,entry] of Object.entries({location:'src/main/theme-location.ts',solar:'src/shared/theme-solar-preview.ts'}))buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',external:['koffi'],outfile:path.join(output,name+'.cjs')});
const {ThemeLocationService}=require(path.join(output,'location.cjs')),{solarSchedulePreview}=require(path.join(output,'solar.cjs'));
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const port=(state,values=[31.2,121.5,40])=>({begin:()=>1,poll:(_id,out)=>{out.writeUInt32LE(state);values.forEach((v,i)=>out.writeDoubleLE(v,8+i*8));return 1;},cancel:()=>{}});
async function main(){
 eq(await new ThemeLocationService(()=>port(2)).locate(),{state:'success',latitude:31.2,longitude:121.5,accuracy:40},'Valid position received');
 for(const [state,result] of [[3,'denied'],[4,'unavailable'],[5,'timeout'],[6,'cancelled'],[0,'unavailable']])eq((await new ThemeLocationService(()=>port(state)).locate()).state,result);
 for(const values of [[91,0,1],[0,181,1],[NaN,0,1],[0,Infinity,1],[0,0,-1],[0,0,NaN]])eq((await new ThemeLocationService(()=>port(2,values)).locate()).state,'unavailable','Invalid native values rejected');
 for(const factory of [()=>{throw Error('missing DLL');},()=>({begin:()=>0}),()=>({begin:()=>1,poll:()=>{throw Error('poll failed');},cancel:()=>{}})])eq((await new ThemeLocationService(factory).locate()).state,'unavailable');
 let cancellations=0,serial=0;const pending={begin:()=>++serial,poll:(_token,out)=>{out.writeUInt32LE(1);return 1;},cancel:()=>cancellations++};
 let service=new ThemeLocationService(()=>pending,10,1);eq((await service.locate()).state,'timeout');eq(cancellations,1,'Timeout cancels native request');
 service=new ThemeLocationService(()=>pending);const first=service.locate(),second=service.locate();eq((await first).state,'cancelled','New request cancels prior one');service.cancel();eq((await second).state,'cancelled');eq(cancellations,3);service.cancel();eq(cancellations,3,'Cancel idempotent');
 const library=require('koffi').load(path.resolve('dist/native/One.Location.dll')),poll=library.func('uint32 one_location_poll(uint32,_Out_ void *,uint32)'),cancel=library.func('void one_location_cancel(uint32)'),buffer=Buffer.alloc(32);
 eq(poll(0,buffer,32),1);eq(buffer.readUInt32LE(0),6,'Real DLL rejects stale token without requesting permission');eq(poll(0,buffer,31),0,'Real DLL validates ABI buffer size');cancel(0);checks++;
 const now=new Date(2026,9,10,12),normal=solarSchedulePreview(30.5,114.4,0,0,now),shifted=solarSchedulePreview(30.5,114.4,-30,45,now);
 eq(normal.kind,'normal');eq(normal.sunrise,normal.lightAt);eq(normal.sunset,normal.darkAt);eq(shifted.lightAt,normal.sunrise-30*60000);eq(shifted.darkAt,normal.sunset+45*60000);
 eq(solarSchedulePreview(null,114,0,0,now),null);eq(solarSchedulePreview(30,null,0,0,now),null);
 eq(solarSchedulePreview(90,0,0,0,new Date(2026,5,21)).kind,'polar-day');eq(solarSchedulePreview(90,0,0,0,new Date(2026,11,21)).kind,'polar-night');
 for(const args of [[91,0,0,0],[0,181,0,0],[0,0,181,0],[0,0,0,0.5]]){assert.throws(()=>solarSchedulePreview(...args,now));checks++;}
 const report={result:'PASS',checks,scope:'Location success/errors, coordinate bounds, timeout/cancel/reentry, production DLL ABI without permission request, solar preview offsets and polar days.'};fs.writeFileSync(path.join(output,'unit-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
