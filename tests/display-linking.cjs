const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{buildSync}=require('esbuild');
const output=path.resolve('work/current/display-linking');fs.mkdirSync(output,{recursive:true});
buildSync({entryPoints:['src/main/display-management.ts','src/shared/settings.ts'],bundle:true,platform:'node',format:'cjs',outdir:output,outbase:'src'});
const {DisplayManagementService}=require(path.join(output,'main/display-management.js')),{defaultSettings,validateSettings,mergeSettings}=require(path.join(output,'shared/settings.js'));
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const rejects=async(p,re)=>{await assert.rejects(p,re);checks++;};
const control=value=>({supported:true,method:'fixture',error:'',minimum:5,maximum:205,raw:5+value*2,value});
const metadata=['a','b','unsupported','clone'].map((key,i)=>({key,path:'path-'+key,name:key,identity:'serial',source:'DISPLAY'+i,internal:i===0,virtual:false,primary:i===0,cloned:key==='clone',width:1920,height:1080,left:i*1920,top:0,rotation:0,refreshRate:60}));
const unsupported={supported:false,method:'',error:'not supported'};
async function main(){
 const defaults=defaultSettings();eq(defaults.displays,{linkedBrightness:false,excluded:[]});const old={...defaults};delete old.displays;eq(validateSettings(old).displays,defaults.displays,'Old settings migrate with linking disabled');
 for(const bad of [null,{linkedBrightness:'true',excluded:[]},{linkedBrightness:true,excluded:['DISPLAY1']},{linkedBrightness:true,excluded:Array(129).fill('a'.repeat(64))}]){assert.throws(()=>mergeSettings(defaults,{displays:bad}));checks++;}
 const id='a'.repeat(64);eq(mergeSettings(defaults,{displays:{excluded:[id,id]}}).displays.excluded,[id]);eq(defaults.displays.excluded,[],'Settings merge does not mutate defaults');
 let prefs={linkedBrightness:false,excluded:[]},calls=[],fail='',afterWrite=()=>{},hold,release;
 const service=new DisplayManagementService(()=>{},async(args,signal)=>{
  if(args[0]==='list')return {displays:metadata};
  if(args[0]==='probe')return {controls:{brightness:args[1]==='path-unsupported'?unsupported:control(50),contrast:control(50),volume:control(50)}};
  calls.push(args.slice());if(hold){const waiter=hold;hold=undefined;await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});waiter();});}
  if(args[1]===fail)return {error:'fixture failure'};
  afterWrite(args);return {control:control(Number(args[4]))};
 },()=>prefs);
 const rows=await service.list(),[a,b,c,d]=rows.map(row=>row.id);
 await service.probe(a);await service.probe(b);await service.probe(c);
 await service.setBrightness(a,25);eq(calls.map(v=>v[1]),['path-a'],'Default writes only source');
 calls=[];prefs.linkedBrightness=true;let result=await service.setBrightness(a,75);eq(calls.map(v=>v[1]),['path-a','path-b'],'Only probed supported nonclone targets join');eq(result.map(r=>r.control.value),[75,75]);
 calls=[];prefs.excluded=[b];await service.setBrightness(a,31);eq(calls.map(v=>v[1]),['path-a'],'Excluded peer is skipped');
 calls=[];prefs.excluded=[a];await service.setBrightness(a,32);eq(calls.map(v=>v[1]),['path-a'],'Excluded source can still be adjusted independently');
 calls=[];prefs.excluded=[];fail='path-a';result=await service.setBrightness(a,40);eq(result.map(r=>[r.id,!!r.error]),[[a,true],[b,false]],'One hardware error does not prevent remaining devices');await rejects(service.setBrightness(a,40),/先检测/);fail='';await service.probe(a);
 calls=[];afterWrite=()=>{prefs.linkedBrightness=false;};await service.setBrightness(a,50);eq(calls.map(v=>v[1]),['path-a'],'Disabling during a batch stops later devices');
 calls=[];prefs.linkedBrightness=true;afterWrite=()=>{prefs.excluded=[b];};await service.setBrightness(a,51);eq(calls.map(v=>v[1]),['path-a'],'Excluding during a batch stops that device');
 afterWrite=()=>{};prefs.excluded=[];calls=[];let started;const began=new Promise(r=>started=r);hold=started;const first=service.setBrightness(a,10);await began;const second=service.setBrightness(a,30),third=service.setBrightness(a,90);release();eq((await first).map(r=>r.control.value),[10,10]);eq((await second).map(r=>r.control.value),[90,90]);await third;eq(calls.map(v=>v[4]),['10','10','90','90'],'Queued linked writes coalesce as a group');
 let begin;const entered=new Promise(r=>begin=r);hold=begin;const pending=service.setBrightness(a,20);await entered;service.invalidate();await rejects(pending,/cancelled|aborted/i);await rejects(service.setBrightness(a,20),/列表/);
 await rejects(service.setBrightness(a,NaN),/参数/);await rejects(service.setBrightness(a,101),/参数/);await service.list();await rejects(service.setBrightness(d,20),/镜像/);await rejects(service.setBrightness(c,20),/先检测/);
 service.stop();const report={result:'PASS',checks,scope:'Settings migration/validation and linked brightness with synthetic hardware: exclusion, capability gates, partial failures, preference changes mid-batch, coalescing, topology cancellation. No real display writes.'};fs.writeFileSync(path.join(output,'unit-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
