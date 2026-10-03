// Owned real filesystem fixture: compare fresh mutable indexing with a streamed
// first image, including all returned metadata, priority scopes and cap behavior.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),koffi=require('koffi'),{createHash}=require('node:crypto');
const {client,delay}=require('./helpers/index-client.cjs');
const Memory=koffi.struct('OneFirstBuildMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'}),kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll'),open=kernel.func('void * __stdcall OpenProcess(uint32,int,uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)'),getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneFirstBuildMemory *, uint32)');
async function build(exe,image,config,terminateOnProgress=false){
 const start=performance.now(),child=spawn(exe,['mapped-scan',image,config],{windowsHide:true,stdio:'pipe'}),handle=open(0x410,0,child.pid);assert.ok(handle);
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});let peakPrivate=0,peakResident=0,samples=0,buffer='',result;const progress=[],errors=[];
 const sample=()=>{const value={cb:koffi.sizeof(Memory)};if(getMemory(handle,value,value.cb)){samples++;peakPrivate=Math.max(peakPrivate,value.PeakPagefileUsage);peakResident=Math.max(peakResident,value.PeakWorkingSetSize);}};
 sample();const timer=setInterval(sample,5),timeout=setTimeout(()=>child.kill(),60000);child.stdout.setEncoding('utf8');child.stderr.on('data',value=>errors.push(value.toString()));
 child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(value.build){progress.push({...value.build,wallMs:performance.now()-start});if(terminateOnProgress&&progress.length===1)child.kill();}else result=value;sample();}});
 try{const exited=await exit;if(terminateOnProgress){assert.notEqual(exited.code,0);assert.ok(progress.length>0);return{terminated:true,progressReports:progress.length};}assert.equal(exited.code,0,JSON.stringify({exited,result,errors}));assert.deepEqual(errors,[]);assert.ok(result&&samples>0);assert.equal(buffer,'');return{...result,wallMs:performance.now()-start,peakPrivate,peakResident,samples,progressReports:progress.length,firstProgressMs:progress[0]?.wallMs,firstRoot:progress[0]?.root};}
 finally{clearInterval(timer);clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null){child.kill();await exit.catch(()=>{});}close(handle);}
}
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/mapped-first-build-native'),profile=path.join(out,'profile'),root=path.join(profile,'source-'+('r'.repeat(85)));await fs.mkdir(root,{recursive:true});
 const exe=path.resolve('work/rust-search/release/one-index.exe'),groups=200,perGroup=1000,folders=Array.from({length:groups},(_,n)=>path.join(root,'group-'+String(n).padStart(3,'0')));
 for(const folder of folders)await fs.mkdir(folder);let serial=0;
 await Promise.all(Array.from({length:24},async()=>{for(;;){const n=serial++;if(n>=groups*perGroup)return;const folder=folders[Math.floor(n/perGroup)],i=n%perGroup,name=(i===0?'季度报告-':'scan-needle-')+String(i).padStart(4,'0')+'-'+('x'.repeat(48))+(i%2?'.TXT':'.json');await fs.writeFile(path.join(folder,name),'');}}));
 // Directory timestamps can settle after bulk file creation. Fix the owned
 // fixture signatures before both scans; keep the exact metadata comparisons.
 const fixtureTime=new Date('2020-01-02T03:04:05.000Z');for(const folder of [root,...folders])await fs.utimes(folder,fixtureTime,fixtureTime);
 await delay(100);for(const folder of [root,...folders])assert.equal((await fs.stat(folder)).mtimeMs,fixtureTime.getTime());
 const settings={roots:[root,folders[23]],excluded:[folders[199]],maxEntries:300000,priorities:[{path:folders[17],priority:'high'},{path:folders[188],priority:'uncommon'}]},config=path.join(profile,'config.json');await fs.writeFile(config,JSON.stringify(settings));
 const cases=[{query:'scan-needle'},{query:'ext:json "scan-needle"'},{query:'jdbg'},{query:'folder: group'},{query:'"source-" "needle"'},{query:'scan-needle',currentFolder:folders[23],progressive:true},{query:'no-result-zzzzzz'}];
 const report={date:new Date().toISOString(),hash:createHash('sha256').update(await fs.readFile(exe)).digest('hex'),files:groups*perGroup,note:'Fresh first builds over the same owned 200k-file fixture with long paths, overlapping roots, exclusions and priority regions. Hot filesystem cache; does not measure a cold boot or live app memory.',rounds:[]};
 for(let round=0;round<2;round++){
  const image=path.join(profile,'image-'+round+'.bin'),cache=path.join(profile,'mutable-'+round+'.bin');let streamed,mutable,reference;
  async function heap(){reference=await client(exe,[cache],settings);await delay(150);mutable={count:reference.count,readyMs:reference.readyMs,memory:reference.memory()};}
  if(round===0){await heap();streamed=await build(exe,image,config);}else{streamed=await build(exe,image,config);await heap();}
  const disk=await client(exe,['mapped-query',image]);
  try{
   assert.equal(reference.state().issues,0);assert.equal(reference.state().error,'');assert.equal(streamed.issues,0);assert.equal(streamed.capped,false);assert.equal(streamed.count,199*1001+1);assert.equal(disk.count,reference.count);assert.equal(streamed.count,disk.count);assert.equal(streamed.firstRoot,folders[17]);
   for(const options of cases){const request={type:'query',scope:710,...options,priorities:settings.priorities,fuzzy:true,pinyin:true};const a=await reference.request(request),b=await disk.request(request);assert.equal(b.result.total,a.result.total,options.query);assert.deepEqual(b.result.items,a.result.items,options.query);assert.equal(b.result.localTotal,a.result.localTotal);if(options.progressive){assert.ok(b.partial&&a.partial);assert.equal(b.partial.total,a.partial.total);assert.deepEqual(b.partial.items,a.partial.items);}}
   for(const folder of [root,folders[17],folders[23],folders[188],folders[199]]){const a=await reference.request({type:'metadata',path:folder}),b=await disk.request({type:'metadata',path:folder});assert.deepEqual(b.result,a.result);}
   let comparedFiles=0;
   for(const folder of [root,...folders]){let after='';do{const request={type:'children',path:folder,after},a=await reference.request(request),b=await disk.request(request);assert.deepEqual(b.result,a.result);comparedFiles+=b.result.items.length;after=b.result.after??'';}while(after);}
   assert.equal(comparedFiles,streamed.count-1);
   // Enumerate every directory and its modification signature, rather than
   // infer completeness from the first hundred search results.
   let after='',comparedDirectories=0;do{const request={type:'directories',settings,cache,after},a=await reference.request(request),b=await disk.request(request);assert.deepEqual(b.result,a.result);comparedDirectories+=b.result.items.length;after=b.result.after??'';}while(after);assert.equal(comparedDirectories,200);
   await delay(150);report.rounds.push({mutable,streamed,idleMapped:disk.memory(),resultsIdentical:true,comparedChildren:comparedFiles,comparedDirectories});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({...report,result:'MEASURED'},null,2));
  }finally{await disk.stop();await reference.stop();}
 }
 const existing=path.join(profile,'image-0.bin'),previous=createHash('sha256').update(await fs.readFile(existing)).digest('hex');report.interrupted=await build(exe,existing,config,true);assert.equal(createHash('sha256').update(await fs.readFile(existing)).digest('hex'),previous);
 assert.ok((await fs.stat(existing.replace(/\.[^.]+$/,'.scan'))).isDirectory());const recovered=await build(exe,existing,config);assert.equal(recovered.count,report.rounds[0].streamed.count);const resumed=await client(exe,['mapped-query',existing]);try{const result=await resumed.request({type:'query',query:'scan-needle',fuzzy:false,pinyin:false});assert.equal(result.result.total,199*999);}finally{await resumed.stop();}report.interrupted.recovered=true;
 const cappedSettings={...settings,maxEntries:1000},cappedConfig=path.join(profile,'capped.json');await fs.writeFile(cappedConfig,JSON.stringify(cappedSettings));
 const cappedImage=path.join(profile,'capped.bin'),capped=await build(exe,cappedImage,cappedConfig),disk=await client(exe,['mapped-query',cappedImage]);
 try{assert.equal(capped.count,1000);assert.equal(capped.capped,true);const result=await disk.request({type:'query',query:'',foldersOnly:false});assert.equal(result.result.total,1000);assert.ok(result.result.items.every(row=>row.path===folders[17]||row.path.startsWith(folders[17]+'\\')));report.capped=capped;}finally{await disk.stop();}
 for(const item of await fs.readdir(profile)){assert.ok(!item.endsWith('.scan')&&!item.endsWith('.tmp'),'Builder left a temporary file: '+item);}
 const average=get=>report.rounds.reduce((sum,r)=>sum+get(r),0)/report.rounds.length;report.peakPrivate={mutable:average(r=>r.mutable.memory.peakPrivate),streamed:average(r=>r.streamed.peakPrivate)};
 assert.ok(report.peakPrivate.streamed<64*1024**2,'First build must not retain a full 200k-record mutable index');assert.ok(report.peakPrivate.streamed<report.peakPrivate.mutable*.7,'First build private-memory improvement must be substantial');for(const round of report.rounds){assert.ok(round.idleMapped.private<32*1024**2);assert.ok(round.idleMapped.resident<32*1024**2);}
 report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',count:report.rounds[0].streamed.count,peakPrivate:report.peakPrivate,buildMs:report.rounds.map(r=>r.streamed.wallMs),capped:capped.count}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
