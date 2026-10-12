const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const Module=require('node:module');
const {spawn}=require('node:child_process');
const {build}=require('esbuild');
const JSZip=require('jszip');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function load(source){const result=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-alz-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
function stored(entries){
 const parts=[Buffer.from('414c5a010a000000','hex')];
 for(const [name,payload] of entries){const raw=Buffer.from(name),header=Buffer.alloc(4+9+6+8);header.writeUInt32LE(0x015a4c42);header.writeUInt16LE(raw.length,4);header[6]=0x20;header[11]=0x40;header.writeUInt32LE(zlib.crc32(payload),15);header.writeUInt32LE(payload.length,19);header.writeUInt32LE(payload.length,23);parts.push(header,raw,payload);}
 parts.push(Buffer.from('434c5a010000000000000000434c5a02','hex'));return Buffer.concat(parts);
}
async function native(args,env={}){
 return new Promise((resolve,reject)=>{const child=spawn(path.resolve('dist/native/One.Archive.exe'),args,{windowsHide:true,env:{...process.env,...env}});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',code=>resolve({code,events:stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)),stderr}));child.stdin.end(Buffer.alloc(4));});
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-alz-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{preparePreview}=await load('src/main/preview-service.ts'),{parseCli}=await load('src/main/archive-cli.ts'),{isArchivePath,archiveBaseName}=await load('src/shared/archive-actions.ts');
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request),browse={directory:'',search:'',flat:true};
  const folder=path.resolve('tests/fixtures/archives/alz'),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  assert.equal(manifest.dlzBlocks,5);
  for(const fixture of manifest.files){
   const data=await fs.readFile(path.join(folder,fixture.name));assert.equal(hash(data),fixture.sha256);assert.equal(data.length,fixture.bytes);
   const source=path.join(root,fixture.name);await fs.writeFile(source,data);const request={path:source,encoding:fixture.encoding,password:fixture.password};
   assert(isArchivePath(source));assert.equal(archiveBaseName(source),source.slice(0,-4));assert.equal(parseCli(['list',source],root).jobs[0].request.path,source);checks++;
   const listing=await run({...request,operation:'list',browse});assert.equal(listing.editable,false);assert(listing.revision);assert.deepEqual(listing.entries.filter(entry=>!entry.directory).map(entry=>entry.name.replace(/\\/g,'/')).sort(),fixture.expected.map(item=>item.name).sort());checks++;
   const first=listing.entries.find(entry=>!entry.directory);const details=await run({...request,operation:'details',index:first.index,revision:listing.revision});assert.equal(details.details.entry.name,first.name);assert.equal(details.details.crc32?.length,8);assert.match(details.details.method,/Store|BZip2|Deflate/);checks++;
   assert.equal((await run({...request,operation:'test'})).count,listing.total);checks++;
   const parent=path.join(root,fixture.name+'.out');await fs.mkdir(parent);const result=await run({...request,operation:'extract',parent,destination:'here'});assert(result.count>=fixture.expected.length);
   for(const item of fixture.expected){const payload=await fs.readFile(path.join(parent,item.name));assert.equal(payload.length,item.bytes);assert.equal(hash(payload),item.sha256,item.name);}checks++;
   const preview=await preparePreview(source,()=>{throw Error('Unexpected raw preview');},async()=>undefined);assert.equal(preview.nativeArchive,true);checks++;
   if(fixture.password){for(const password of ['', 'incorrect'])await assert.rejects(run({...request,operation:'test',password}),error=>error.code==='password');checks+=2;}
  }
  const methods=path.join(root,'methods.alz');
  assert.equal(parseCli(['list','--encoding','949',methods],root).jobs[0].request.encoding,949);
  assert.equal((await run({operation:'test',path:path.join(root,'korean-password.alz'),password:'비밀',encoding:949})).count,1);checks+=2;
  const folderRows=await run({operation:'list',path:methods,browse:{directory:'folder/',search:'',flat:false}});assert.equal(folderRows.entries.length,2);assert(folderRows.entries.some(entry=>entry.name.includes('한글')));checks++;
  const parent=path.join(root,'selected-folder');await fs.mkdir(parent);const selected=await run({operation:'extract',path:methods,parent,destination:'here',selectedFolders:['folder/']});assert(selected.count>=2);assert.equal(await fs.stat(path.join(parent,'dlz.txt')).catch(()=>null),null);assert.equal(await fs.readFile(path.join(parent,'folder/stored.txt'),'utf8'),'stored\n');checks++;
  await assert.rejects(run({operation:'create',path:path.join(root,'not-created.alz'),sources:[methods]}),/不支持/);
  const editableCheck=await run({operation:'list',path:methods,browse});await assert.rejects(run({operation:'update',path:methods,revision:editableCheck.revision,changes:[{kind:'delete',indexes:[1]}]}),/ZIP 和 7Z/);checks+=2;
  const nested=new JSZip();nested.file('nested.alz','payload');const nestedPath=path.join(root,'nested.zip'),nestedOutput=path.join(root,'nested.out');await fs.writeFile(nestedPath,await nested.generateAsync({type:'nodebuffer'}));await fs.mkdir(nestedOutput);
  const nestedResult=await run({operation:'extract',path:nestedPath,parent:nestedOutput,destination:'here'});assert.equal(nestedResult.count,1);assert(!nestedResult.risk);assert.equal(await fs.readFile(path.join(nestedOutput,'nested.alz'),'utf8'),'payload');checks++;
  // Structural failures must be rejected before output is created.
  const base=stored([['safe.txt',Buffer.from('hello')]]),mutations=[];
  for(const length of [0,1,4,7,8,12,20,28,base.length-1,base.length-8])mutations.push(['truncate-'+length,base.subarray(0,length)]);
  for(const [name,offset,value] of [['version',4,9],['width3',19,0x30],['width15',19,0xf0],['descriptor',19,0x44],['method',21,3],['reserved',20,1],['method-flags',22,1],['attributes',14,0x28]]){const bytes=Buffer.from(base);bytes[offset]=value;mutations.push([name,bytes]);}
  for(const value of [0,65535]){const bytes=Buffer.from(base);bytes.writeUInt16LE(value,12);mutations.push(['name-length-'+value,bytes]);}
  const huge=Buffer.from(base);huge.writeUInt32LE(0xffffffff,27);mutations.push(['packed-overflow',huge]);
  for(const [name,bytes] of mutations){const source=path.join(root,name+'.alz'),output=path.join(root,name+'.out');await fs.writeFile(source,bytes);await fs.mkdir(output);
   await assert.rejects(run({operation:'list',path:source}),undefined,name);await assert.rejects(run({operation:'extract',path:source,parent:output,destination:'here'}),undefined,name);assert.deepEqual(await fs.readdir(output),[]);checks+=2;}
  for(const [name,entries] of [
   ['traversal',[['../outside.txt',Buffer.from('x')]]],['nul-name',[['bad\0.txt',Buffer.from('x')]]],['ads',[['name:stream',Buffer.from('x')]]],
   ['duplicate',[['safe.txt',Buffer.from('x')],['SAFE.TXT',Buffer.from('y')]]],['parent-file',[['folder',Buffer.from('x')],['folder/child.txt',Buffer.from('y')]]],
  ]){const source=path.join(root,name+'.alz'),output=path.join(root,name+'.out');await fs.writeFile(source,stored(entries));await fs.mkdir(output);
   await assert.rejects(run({operation:'extract',path:source,parent:output,destination:'here'}),error=>error.code==='safety');assert.deepEqual(await fs.readdir(output),[]);checks++;}
  for(const [name,offset] of [['crc',23],['declared-size',31],['stored-data',base.length-17]]){const bytes=Buffer.from(base);bytes[offset]^=1;const source=path.join(root,name+'.alz'),output=path.join(root,name+'.out');await fs.writeFile(source,bytes);await fs.mkdir(output);
   await assert.rejects(run({operation:'test',path:source}));await assert.rejects(run({operation:'extract',path:source,parent:output,destination:'here'}));assert.deepEqual(await fs.readdir(output),[]);checks+=2;}
  for(const method of [1,2]){const source=path.join(root,'bad-stream-'+method+'.alz');const bytes=stored([['safe.txt',Buffer.from('broken stream')]]);bytes[21]=method;await fs.writeFile(source,bytes);await assert.rejects(run({operation:'test',path:source}));checks++;}
  const damagedDlz=await fs.readFile(path.join(root,'dlz-multiblock.alz'));
  for(const offset of [44,45,46,47,48,49,50,51,100,1000,Math.floor(damagedDlz.length/2),damagedDlz.length-17]){
   const bytes=Buffer.from(damagedDlz);bytes[offset]^=128;const source=path.join(root,'damaged-dlz-'+offset+'.alz');await fs.writeFile(source,bytes);const result=await native(['test',source]);assert([1,2].includes(result.code),`Corrupt DLZ offset ${offset}: exit ${result.code}`);assert.equal(result.events.at(-1)?.type,'error');checks++;
  }
  await fs.writeFile(path.join(root,'methods.a00'),Buffer.from('volume'));assert.equal((await run({operation:'list',path:methods})).total,editableCheck.total);await assert.rejects(run({operation:'list',path:path.join(root,'methods.a00')}),/未被首卷声明/);await fs.unlink(path.join(root,'methods.a00'));checks++;
  // Enforce the common budget during integrity testing, before allocating the
  // full decoded member. Repeat across multiple entries to cover accumulation.
  for(const name of ['dlz-multiblock.alz','uncompressed.alz']){const result=await native(['test',path.join(root,name)],{ONE_ARCHIVE_EXTRACT_MAX_BYTES:'8'});assert.notEqual(result.code,0);assert.equal(result.events.at(-1)?.code,'resource');checks++;}
  // GetTickCount64 has coarse Windows clock resolution. Repeat valid DLZ
  // members so the workload outlasts a tick without relying on machine speed
  // for a single small fixture. Integrity testing need not publish paths.
  const dlz=await fs.readFile(path.join(root,'dlz-multiblock.alz')),slow=path.join(root,'time-budget.alz');await fs.writeFile(slow,Buffer.concat([dlz.subarray(0,8),...Array(32).fill(dlz.subarray(8,-16)),dlz.subarray(-16)]));
  const result=await native(['test',slow],{ONE_ARCHIVE_EXTRACT_MAX_MS:'1'});assert.notEqual(result.code,0);assert.equal(result.events.at(-1)?.code,'resource');checks++;
  let cancelled=false;const cancelling=new ArchiveService(path.join(root,'cancel-cache'),(owner,progress)=>{if(!cancelled&&progress.operation==='test'){cancelled=cancelling.cancel(progress.id,owner);}});
  try{await assert.rejects(cancelling.run(3,{operation:'test',path:slow}),/取消|cancel/i);assert(cancelled);checks++;}finally{await cancelling.stop();}
  // CP949 shares the filename code-page type with ZIP password compatibility.
  const zip=path.join(root,'korean-password.zip'),input=path.join(root,'zip-source.txt');await fs.writeFile(input,'Korean password compatibility');
  await run({operation:'create',path:zip,sources:[input],password:'비밀',passwordEncoding:949});await run({operation:'test',path:zip,password:'비밀',passwordEncoding:949});checks++;
  console.log(`ALZ passed: ${checks} checks, ${manifest.files.length} pinned/generated fixtures, five-block DLZ, passwords, exact output, read-only flows and hostile metadata.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
