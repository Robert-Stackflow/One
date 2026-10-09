const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const Module=require('node:module');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {performance}=require('node:perf_hooks');
const {build}=require('esbuild');
const koffi=require('koffi');
const execute=promisify(execFile);
const seven=args=>execute('7z',args,{windowsHide:true,maxBuffer:1024**2,timeout:300000});
const gib=1024**3,mib=1024**2;
const sizeGiB=process.argv[2]===undefined?4:Number(process.argv[2]);
assert(Number.isInteger(sizeGiB)&&sizeGiB>=4&&sizeGiB<=10,'size must be 4–10 GiB');

// Measure the actual helpers, not the Node driver or configured Job limit.
const kernel=koffi.load('kernel32.dll');
const open=kernel.func('uintptr_t __stdcall OpenProcess(uint32_t,bool,uint32_t)');
const close=kernel.func('bool __stdcall CloseHandle(uintptr_t)');
const memory=kernel.func('bool __stdcall K32GetProcessMemoryInfo(uintptr_t,void*,uint32_t)');
const times=kernel.func('bool __stdcall GetProcessTimes(uintptr_t,void*,void*,void*,void*)');
const io=kernel.func('bool __stdcall GetProcessIoCounters(uintptr_t,void*)');
const hash=async file=>{const value=crypto.createHash('sha256');for await(const block of createReadStream(file,{highWaterMark:mib}))value.update(block);return value.digest('hex');};

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-large-'));
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP};let service,timer,deadline,label='setup',last=performance.now();
 const processes=new Map(),delays=[],measurements=[];
 const removeOwned=async directory=>{const relative=path.relative(root,path.resolve(directory));assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'unexpected extraction result path');await fs.rm(directory,{recursive:true,force:true});};
 const report={schema:1,date:new Date().toISOString(),sourceBytes:sizeGiB*gib+65537,platform:process.platform,release:os.release(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,ramBytes:os.totalmem(),resources:{threads:1,memoryMiB:256},source:'Sparse zero file with nonzero markers at start, 2 GiB, across 4 GiB and EOF; all operations process the full logical content.',measurements};
 const sample=()=>{
  const now=performance.now();delays.push(Math.max(0,now-last-20));last=now;
  for(const {child} of service?.active?.values()??[]){if(!child.pid||processes.has(child.pid))continue;const handle=open(0x410,false,child.pid);if(!handle)continue;processes.set(child.pid,{handle,label,peakWorkingSet:0,peakPrivate:0,cpuMs:0,readBytes:0,writeBytes:0});}
  for(const value of processes.values()){
   const bytes=Buffer.alloc(80);bytes.writeUInt32LE(bytes.length);if(memory(value.handle,bytes,bytes.length)){value.peakWorkingSet=Math.max(value.peakWorkingSet,Number(bytes.readBigUInt64LE(8)));value.peakPrivate=Math.max(value.peakPrivate,Number(bytes.readBigUInt64LE(72)));}
   const created=Buffer.alloc(8),exited=Buffer.alloc(8),system=Buffer.alloc(8),user=Buffer.alloc(8);if(times(value.handle,created,exited,system,user))value.cpuMs=Number(system.readBigUInt64LE()+user.readBigUInt64LE())/10000;
   const counters=Buffer.alloc(48);if(io(value.handle,counters)){value.readBytes=Number(counters.readBigUInt64LE(24));value.writeBytes=Number(counters.readBigUInt64LE(32));}
  }
 };
 const measured=async(name,fn)=>{label=name;const start=performance.now();console.log('ZIP64: '+name);const value=await fn();sample();const metrics=[...processes.values()].filter(item=>item.label===name);measurements.push({name,elapsedMs:Math.round(performance.now()-start),helpers:metrics.length,peakWorkingSetBytes:metrics.length?Math.max(...metrics.map(item=>item.peakWorkingSet)):null,peakPrivateBytes:metrics.length?Math.max(...metrics.map(item=>item.peakPrivate)):null,cpuMs:metrics.length?Math.round(metrics.reduce((sum,item)=>sum+item.cpuMs,0)):null,readBytes:metrics.length?metrics.reduce((sum,item)=>sum+item.readBytes,0):null,writeBytes:metrics.length?metrics.reduce((sum,item)=>sum+item.writeBytes,0):null});return value;};
 const readAt=async(file,position,length)=>{const handle=await fs.open(file,'r');try{const bytes=Buffer.alloc(length);assert.equal((await handle.read(bytes,0,length,position)).bytesRead,length);return bytes;}finally{await handle.close();}};
 const zip64=async(file)=>{
  const length=(await fs.stat(file)).size,tail=await readAt(file,length-98,98);
  // A ZIP64 entry with small compressed data can legally retain the ordinary
  // EOCD. The 64-bit end record is required when the directory offset overflows.
  const end=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert(end>=0&&tail.length-end>=22,'EOCD missing');
  const locator=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x06,0x07]));let centralOffset;
  if(locator>=0){const record=await readAt(file,Number(tail.readBigUInt64LE(locator+8)),56);assert.equal(record.readUInt32LE(),0x06064b50);assert.equal(record.readBigUInt64LE(32),1n);centralOffset=Number(record.readBigUInt64LE(48));}
  else{assert.equal(tail.readUInt16LE(end+10),1);centralOffset=tail.readUInt32LE(end+16);assert.notEqual(centralOffset,0xffffffff,'overflowing directory offset needs ZIP64 EOCD');}
  const central=await readAt(file,centralOffset,46);assert.equal(central.readUInt32LE(),0x02014b50);
  assert.equal(central.readUInt32LE(24),0xffffffff,'ZIP64 uncompressed sentinel missing');
  const extra=await readAt(file,centralOffset+46+central.readUInt16LE(28),central.readUInt16LE(30));let uncompressed;
  for(let offset=0;offset+4<=extra.length;offset+=4+extra.readUInt16LE(offset+2))if(extra.readUInt16LE(offset)===1){uncompressed=extra.readBigUInt64LE(offset+4);break;}
  assert.equal(uncompressed,BigInt(report.sourceBytes));return {archiveBytes:length,centralOffset,zip64End:locator>=0,uncompressedBytes:Number(uncompressed),compressedField:central.readUInt32LE(20)};
 };
 try{
  Object.assign(process.env,{TEMP:root,TMP:root});
  const volume=await fs.statfs(root);assert(Number(volume.bavail)*Number(volume.bsize)>report.sourceBytes*5+gib,'not enough free space for isolated large-file verification');
  const external=await seven(['i']);report.external=external.stdout.match(/7-Zip[^\r\n]*/)?.[0]??'7z';
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-large-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  service=new mod.exports.ArchiveService(path.join(root,'cache'),()=>{},()=> '0',()=>{},false,undefined,()=>report.resources);
  deadline=setTimeout(()=>void service.stop(),20*60*1000);timer=setInterval(sample,20);
  const run=async request=>{const result=await service.run(1,request);if(result.risk)return service.run(1,{...request,riskApproval:{revision:result.risk.revision,maxBytes:64*gib,maxMilliseconds:20*60*1000}});return result;},source=path.join(root,'超过4GiB.bin');const handle=await fs.open(source,'wx');
  try{await execute('fsutil',['sparse','setflag',source],{windowsHide:true});await handle.truncate(report.sourceBytes);for(const position of [0,2*gib,4*gib-2048,report.sourceBytes-4096]){const marker=crypto.createHash('sha256').update(String(position)).digest();await handle.write(Buffer.alloc(4096,marker),0,4096,position);}}finally{await handle.close();}
  assert.equal((await fs.stat(source)).size,report.sourceBytes);const sourceHash=await measured('source SHA-256',()=>hash(source));report.sourceSHA256=sourceHash;
  const stored=path.join(root,'stored.zip');await measured('One stored ZIP64 create and verify',()=>run({operation:'create',path:stored,sources:[source],level:0}));report.stored=await zip64(stored);assert(report.stored.archiveBytes>4*gib&&report.stored.centralOffset>4*gib&&report.stored.zip64End);assert.equal(report.stored.compressedField,0xffffffff);
  let listing=await measured('One ZIP64 list',()=>run({operation:'list',path:stored}));assert.equal(listing.entries[0].size,report.sourceBytes);assert.equal(listing.total,1);
  await measured('One stored ZIP64 integrity',()=>run({operation:'test',path:stored}));
  let result=await measured('One stored ZIP64 extract',()=>run({operation:'extract',path:stored,parent:root,selected:[listing.entries[0].index]}));assert.equal((await fs.stat(path.join(result.path,path.basename(source)))).size,report.sourceBytes);assert.equal(await measured('stored output SHA-256',()=>hash(path.join(result.path,path.basename(source)))),sourceHash);await removeOwned(result.path);
  await measured('One stored ZIP64 transactional rename',()=>run({operation:'update',path:stored,revision:listing.revision,changes:[{kind:'rename',index:0,name:'大文件已改名.bin'}]}));listing=await run({operation:'list',path:stored});assert.equal(listing.entries[0].name,'大文件已改名.bin');assert.equal(listing.entries[0].size,report.sourceBytes);await zip64(stored);
  await measured('7-Zip reads One stored ZIP64',()=>seven(['t','-y',stored]));await fs.rm(stored);
  const encrypted=path.join(root,'aes.zip'),password=' private ZIP64 密码 ';
  await measured('One AES deflate ZIP64 create and verify',()=>run({operation:'create',path:encrypted,sources:[source],password,level:1}));report.encrypted=await zip64(encrypted);
  listing=await run({operation:'list',path:encrypted});assert.equal(listing.entries[0].size,report.sourceBytes);assert(listing.entries[0].encrypted);
  await assert.rejects(run({operation:'test',path:encrypted,password:'wrong'}));
  result=await measured('One AES ZIP64 extract',()=>run({operation:'extract',path:encrypted,parent:root,password}));assert.equal(await measured('AES output SHA-256',()=>hash(path.join(result.path,path.basename(source)))),sourceHash);await removeOwned(result.path);
  const getACP=kernel.func('uint32_t __stdcall GetACP()');
  report.unicodeZipPassword={oneRoundtrip:true,sevenZipCompatible:true,windowsCodePage:getACP()};
  try{await measured('7-Zip reads One Unicode-password AES ZIP64',()=>seven(['t','-y','-p'+password,encrypted]));}
  catch(error){if(error.code!==2||!/Wrong password/i.test(error.stderr??''))throw error;report.unicodeZipPassword.sevenZipCompatible=false;console.log('ZIP64: confirmed external Unicode ZIP password incompatibility on this Windows code page');}
  await fs.rm(encrypted);
  const compatible=path.join(root,'ascii-aes.zip'),asciiPassword=' private ZIP64 password ';
  await measured('One ASCII-password AES ZIP64 create and verify',()=>run({operation:'create',path:compatible,sources:[source],password:asciiPassword,level:1}));report.asciiEncrypted=await zip64(compatible);
  await measured('7-Zip reads One ASCII-password AES ZIP64',()=>seven(['t','-y','-p'+asciiPassword,compatible]));await fs.rm(compatible);
  const externalZip=path.join(root,'external.zip');await measured('7-Zip creates stored ZIP64',()=>seven(['a','-tzip','-mx=0','-y',externalZip,source]));report.externalZip=await zip64(externalZip);
  listing=await run({operation:'list',path:externalZip});assert.equal(listing.entries[0].size,report.sourceBytes);
  result=await measured('One reads external ZIP64',()=>run({operation:'extract',path:externalZip,parent:root}));assert.equal(await measured('external output SHA-256',()=>hash(path.join(result.path,path.basename(source)))),sourceHash);
  sample();const peaks=[...processes.values()];assert(peaks.length>=6,'helper sampling did not run');assert(peaks.every(item=>item.peakWorkingSet>0&&item.peakWorkingSet<256*mib),'native working set exceeded the planned 256 MiB target');
  // Short-lived list/password-rejection helpers may exit before OpenProcess.
  // Every sustained native operation must still have real process measurements.
  for(const name of ['One stored ZIP64 create and verify','One stored ZIP64 integrity','One stored ZIP64 extract','One stored ZIP64 transactional rename','One AES deflate ZIP64 create and verify','One AES ZIP64 extract','One ASCII-password AES ZIP64 create and verify','One reads external ZIP64'])assert(measurements.some(item=>item.name===name&&item.helpers>0),'missing helper measurements: '+name);
  delays.sort((a,b)=>a-b);report.nodeTimer={samples:delays.length,p95DelayMs:delays[Math.floor(delays.length*.95)],p99DelayMs:delays[Math.floor(delays.length*.99)],maxDelayMs:delays.at(-1),scope:'20 ms timer in the Node archive service driver, not Electron renderer acceptance'};
  report.limits='Sparse/zero-dominated local NTFS data. Does not prove mixed-data throughput, compression ratio, network shares, million-entry directory performance, native UI responsiveness, or abrupt power-loss recovery. Unicode ZIP password interoperability is reported separately and is not required to pass this ZIP64 gate.';
  report.passed=true;await fs.mkdir('verification/archive-large',{recursive:true});await fs.writeFile('verification/archive-large/latest.json',JSON.stringify(report,null,2)+'\n');
  console.log('ZIP64 large-file verification passed; report: verification/archive-large/latest.json');
 }catch(error){
  report.passed=false;report.failure={phase:label,code:error?.code??'assertion'};await fs.mkdir('verification/archive-large',{recursive:true});await fs.writeFile('verification/archive-large/latest.json',JSON.stringify(report,null,2)+'\n');throw error;
 }finally{
  clearInterval(timer);clearTimeout(deadline);await service?.stop();for(const value of processes.values())close(value.handle);for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
