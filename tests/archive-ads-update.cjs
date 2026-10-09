const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawn}=require('node:child_process');
const {build}=require('esbuild');
const koffi=require('koffi');
const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
async function load(source){const compiled=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const file=path.resolve('dist/main/archive-ads-test.cjs'),mod=new Module(file);mod.filename=file;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,file);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-ads-'));let service;
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{archiveEditPacket}=await load('src/main/archive-update.ts');service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request),input=path.join(root,'input.txt'),zone='[ZoneTransfer]\r\nZoneId=3\r\n';await fs.writeFile(input,'original data');
  for(const extension of ['zip','7z'])for(const stream of ['Zone.Identifier','one-custom-stream']){
   const archive=path.join(root,extension+'-'+stream+'.'+extension);await run({operation:'create',path:archive,sources:[input]});await fs.writeFile(archive+':'+stream,zone);
   let listing=await run({operation:'list',path:archive});const renamed=await run({operation:'update',path:archive,revision:listing.revision,changes:[{kind:'rename',index:0,name:'renamed.txt'}]});listing=await run({operation:'list',path:archive});assert.equal(renamed.revision,listing.revision);assert.equal(listing.entries[0].name,'renamed.txt');assert.equal(await fs.readFile(archive+':'+stream,'utf8'),zone);await run({operation:'test',path:archive});
   const repeated=await run({operation:'update',path:archive,revision:listing.revision,changes:[{kind:'rename',index:0,name:'again.txt'}]});assert.equal(repeated.revision,(await run({operation:'list',path:archive})).revision);
  }
  // Tamper with the prepared bytes after validation, preserving size, file ID
  // and the exact 100 ns timestamp. A metadata merge must not excuse it.
  const archive=path.join(root,'tamper.zip');await run({operation:'create',path:archive,sources:[input]});await fs.writeFile(archive+':Zone.Identifier',zone);const original=await fs.readFile(archive),listing=await run({operation:'list',path:archive}),temporary=path.join(root,'prepared.zip'),backup=path.join(root,'backup.zip');
  const kernel=koffi.load('kernel32.dll'),open=kernel.func('void* __stdcall CreateFileW(str16, uint32_t, uint32_t, void*, uint32_t, uint32_t, void*)'),setTime=kernel.func('bool __stdcall SetFileTime(void*, void*, void*, void*)'),close=kernel.func('bool __stdcall CloseHandle(void*)');
  const packet=await archiveEditPacket([{kind:'rename',index:0,name:'renamed.txt'}]),child=spawn(path.resolve('dist/native/One.Archive.exe'),['update',archive,temporary,backup,'0',listing.revision],{windowsHide:true,stdio:'pipe'});let output='',handled=false,mutation,mutationError;
  child.stdin.on('error',()=>{});child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(!handled&&output.includes('"type":"ready"')){handled=true;mutation=(async()=>{const stat=await fs.stat(temporary,{bigint:true}),bytes=await fs.readFile(temporary);bytes[bytes.length-1]^=1;await fs.writeFile(temporary,bytes);const time=Buffer.alloc(8);time.writeBigUInt64LE(stat.mtimeNs/100n+116444736000000000n);const handle=open(temporary,0x100,7,null,3,0x200000,null);assert(handle);try{assert(setTime(handle,null,null,time));}finally{close(handle);}assert.equal((await fs.stat(temporary,{bigint:true})).mtimeNs,stat.mtimeNs);child.stdin.end(Buffer.from([1]));})().catch(error=>{mutationError=error;child.kill();});}});
  child.stdin.write(Buffer.concat([Buffer.alloc(4),packet]));const timer=setTimeout(()=>child.kill(),30000);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timer);await mutation;if(mutationError)throw mutationError;
  assert(handled);assert.notEqual(code,0);assert.match(output,/Archive changed after replacement/);assert.equal(hash(await fs.readFile(backup)),hash(original),'Original recovery copy must survive content conflict');
  console.log('Archive ADS updates passed: ZIP/7Z, download/custom streams, preserved metadata, continuous revisions and same-size/time prepared-content tampering with recovery copy retained.');
 }finally{await service?.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
