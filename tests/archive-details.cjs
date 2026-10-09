const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {build}=require('esbuild');
const JSZip=require('jszip');

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return ((crc^0xffffffff)>>>0).toString(16).toUpperCase().padStart(8,'0');}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-details-'));let service;
 const old={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/shared/archive-details.ts','src/main/archive-tasks.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-details-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>path.basename(file.path)===name+'.js').text,filename);return mod.exports;};
  const history=new (load('archive-tasks').ArchiveTasks)(path.join(root,'history.json'));service=new (load('archive-service').ArchiveService)(path.join(root,'cache'),()=>{},()=> '0',()=>{},false,history);
  const run=request=>service.run(1,request),details=async(archive,name,password='')=>{const listing=await run({operation:'list',path:archive,password,browse:{directory:'',search:name,flat:true}});const entry=listing.entries.find(entry=>entry.name.endsWith(name));assert(entry);const response=await run({operation:'details',path:archive,password,index:entry.index,revision:listing.revision});assert.equal(response.details.entry.name,entry.name);assert.equal(response.details.entry.index,entry.index);return response.details;};
  const data=Buffer.from('metadata sample 中文 '.repeat(500)),date=new Date(2022,3,6,12,14,16),zip=path.join(root,'metadata.zip');
  // JSZip writes UTC components into DOS local-time fields; encode the intended wall clock.
  const zipDate=new Date(Date.UTC(2022,3,6,12,14,16));
  const fixture=new JSZip();fixture.file('目录/记录.txt',data,{date:zipDate,createFolders:false});fixture.file('empty.txt','',{date:zipDate});for(let i=0;i<405;i++)fixture.file('late-'+i+'.txt','late '+i,{date:zipDate});await fs.writeFile(zip,await fixture.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const original=await fs.readFile(zip),initial=(await history.overview()).recent.length;
  const normal=await details(zip,'记录.txt');assert.equal(normal.crc32,crc32(data));assert.equal(normal.packedKnown,true);assert.equal(normal.packedShared,false);assert(normal.entry.compressed<data.length);assert.match(normal.method,/deflat/i);assert.equal(normal.modified,date.getTime());
  assert.equal((await details(zip,'empty.txt')).crc32,'00000000','zero is a real CRC for an empty file');assert.equal((await details(zip,'late-404.txt')).crc32,crc32(Buffer.from('late 404')));
  assert.equal((await history.overview()).recent.length,initial,'read-only details never add task history');assert.deepEqual(await fs.readFile(zip),original);
  const source=path.join(root,'内容.txt');await fs.writeFile(source,data);await fs.utimes(source,date,date);
  for(const format of ['zip','7z','tar','tar.gz','tar.xz','gz','xz']){
   const archive=path.join(root,'native.'+format),password=['zip','7z'].includes(format)?' secret ':'';
   await run({operation:'create',path:archive,sources:[source],password});const metadata=await details(archive,format==='xz'?'native':format==='gz'?'内容.txt':'内容.txt',password);
   assert.equal(metadata.entry.size,data.length);assert.equal(metadata.entry.encrypted,!!password);if(format!=='xz')assert(Number.isSafeInteger(metadata.modified),'recorded modification time is required for '+format);assert(metadata.modified===undefined||Math.abs(metadata.modified-date.getTime())<=2000);if(['zip','7z','gz','xz'].includes(format))assert(metadata.method,'recorded compression method is required for '+format);
   if(format==='zip'){
    assert.equal(metadata.crc32,crc32(data),'AE-1 retains its CRC');
    const bytes=await fs.readFile(archive),central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])),local=bytes.readUInt32LE(central+42);
    const version=(start,length)=>{for(let at=start;at<start+length;){const tag=bytes.readUInt16LE(at),size=bytes.readUInt16LE(at+2);if(tag===0x9901){bytes.writeUInt16LE(2,at+4);return;}at+=4+size;}assert.fail('AES extra field is required');};
    version(central+46+bytes.readUInt16LE(central+28),bytes.readUInt16LE(central+30));version(local+30+bytes.readUInt16LE(local+26),bytes.readUInt16LE(local+28));bytes.writeUInt32LE(0,central+16);bytes.writeUInt32LE(0,local+14);
    const ae2=path.join(root,'ae2.zip');await fs.writeFile(ae2,bytes);await run({operation:'test',path:ae2,password});assert.equal((await details(ae2,'内容.txt',password)).crc32,undefined,'AE-2 authentication does not expose a usable CRC');
   }
   if(['7z','gz'].includes(format))assert.equal(metadata.crc32,crc32(data));if(format==='tar')assert.equal(metadata.crc32,undefined);
  }
  for(const format of ['rar4','rar5']){
   const archive=path.resolve(`tests/fixtures/${format}-sample.rar`),listing=await run({operation:'list',path:archive});const entry=listing.entries.find(item=>!item.directory);const metadata=(await run({operation:'details',path:archive,index:entry.index,revision:listing.revision})).details;assert.equal(metadata.entry.size,entry.size);assert.match(metadata.crc32,/^[A-F0-9]{8}$/);assert(metadata.method);assert(Number.isSafeInteger(metadata.modified));
  }
  const solid=path.join(root,'solid.7z'),second=path.join(root,'second.txt');await fs.writeFile(second,data);await run({operation:'create',path:solid,sources:[source,second]});assert.equal((await details(solid,'内容.txt')).packedShared,true,'shared solid blocks must not imply a per-file ratio');
  const random=path.join(root,'random.bin');await fs.writeFile(random,require('node:crypto').randomBytes(1500000));
  for(const format of ['zip','7z']){const target=path.join(root,'split.'+format),created=await run({operation:'create',path:target,sources:[random,source],volumeBytes:1024**2});const metadata=await details(created.path,'内容.txt');assert.equal(metadata.crc32,crc32(data));assert.equal(metadata.entry.size,data.length);}
  const snapshot=await run({operation:'list',path:zip});for(const index of [-1,1.5,1000000,999999])await assert.rejects(run({operation:'details',path:zip,index,revision:snapshot.revision}));
  await assert.rejects(run({operation:'details',path:zip,index:0,revision:''}));await fs.appendFile(zip,'changed');await assert.rejects(run({operation:'details',path:zip,index:0,revision:snapshot.revision}),/changed/);
  const validate=load('archive-details').archiveEntryDetails;for(const value of [null,{}, {...normal,packedKnown:'yes'},{...normal,modified:Infinity},{...normal,crc32:'<script>'},{...normal,method:'bad\nvalue'},{...normal,entry:{...normal.entry,size:2**54}},{...normal,entry:{...normal.entry,sizeKnown:'no'}}])assert.throws(()=>validate(value));assert.deepEqual(validate({...normal,password:'private',entry:{...normal.entry,unsafe:'drop'}}),normal);
  assert.equal(validate({...normal,entry:{...normal.entry,sizeKnown:false}}).entry.sizeKnown,false);
  assert.equal(service.pendingTasks,0);assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-extract-')));
  console.log('Archive details passed: ZIP/7Z/RAR/TAR/GZ/XZ/composites, CRC including zero and AE-2 absence, timestamps, methods, unknown metadata, solid block semantics, off-page identity, stale/invalid requests, bounded protocol, read-only source/history and cleanup.');
 }finally{await service?.stop();for(const [key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
