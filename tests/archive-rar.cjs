const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const text=value=>{const data=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32LE(data.length);return Buffer.concat([size,data]);};
const crc=data=>{let value=0xffffffff;for(const byte of data){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}const bytes=Buffer.alloc(4);bytes.writeUInt32LE((value^0xffffffff)>>>0);return bytes;};
const vint=value=>{const bytes=[];do{bytes.push((value&127)|(value>127?128:0));value=Math.floor(value/128);}while(value);return Buffer.from(bytes);};
const block=header=>{const data=Buffer.concat([vint(header.length),header]);return Buffer.concat([crc(data),data]);};
// Stored RAR5 file/service records follow RARLAB's published format. The CMT
// record is an actual archive comment, not text appended outside the archive.
const record=(type,name,value)=>{const filename=Buffer.from(name),data=Buffer.from(value);return Buffer.concat([block(Buffer.concat([vint(type),vint(2),vint(data.length),vint(4),vint(data.length),vint(0),crc(data),vint(0),vint(0),vint(filename.length),filename])),data]);};
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-rar-'));let service;
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});
 const fixtureRoot=path.resolve('tests/fixtures/rar'),manifest=JSON.parse(await fs.readFile(path.join(fixtureRoot,'manifest.json'),'utf8'));
 const native=(operation,source,password='',extra=[])=>{
  const args=[operation,source,...(operation==='list'?['0','200','0']:['0']),...extra];
  const result=spawnSync(path.resolve('dist/native/One.Archive.exe'),args,{input:text(password),encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,ONE_TEST_MODE:'1'}});
  assert(!result.error,String(result.error));const messages=result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  return {status:result.status,messages,last:messages.at(-1)};
 };
 try{
  for(const fixture of manifest.files){const bytes=await fs.readFile(path.join(fixtureRoot,fixture.name));assert.equal(bytes.length,fixture.bytes);assert.equal(hash(bytes),fixture.sha256);await fs.writeFile(path.join(root,fixture.name),bytes);}
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const filename=path.resolve('dist/main/archive-rar-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  service=new mod.exports.ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const browse={directory:'',search:'',flat:true};
  for(const version of [4,5])for(const suffix of ['encrypted','encrypted_filenames','solid_encrypted','solid_encrypted_filenames']){
   const source=path.join(root,`test_read_format_rar${version}_${suffix}.rar`),headers=suffix.includes('filenames'),mixed=suffix==='encrypted';
   if(headers){await assert.rejects(run({operation:'list',path:source}),error=>error.code==='password');await assert.rejects(run({operation:'list',path:source,password:'wrong'}),/Cannot open archive|无法打开压缩包/);}
   const listing=await run({operation:'list',path:source,password:headers?'password':'',browse});
   assert.equal(listing.total,4);assert.equal(listing.editable,false);assert.deepEqual(listing.entries.map(entry=>entry.name),['a.txt','b.txt','c.txt','d.txt']);
   assert.deepEqual(listing.entries.map(entry=>entry.encrypted),mixed?[false,true,false,true]:[true,true,true,true]);
   if(mixed){
    // This archive deliberately uses two different passwords. A whole-archive
    // operation must fail without publishing the already decoded entries.
    await assert.rejects(run({operation:'test',path:source,password:'password'}),/failed or password/);
    const output=path.join(root,`failed-rar${version}`);await fs.mkdir(output);
    await assert.rejects(run({operation:'extract',path:source,parent:output,password:'password'}),/Cannot extract archive/);assert.deepEqual(await fs.readdir(output),[]);
    for(const [name,password] of [['a.txt',''],['b.txt','password'],['c.txt',''],['d.txt','password2']]){
     const entry=listing.entries.find(entry=>entry.name===name),result=await run({operation:'extract',path:source,parent:root,selected:[entry.index],password});
     assert.deepEqual(await fs.readdir(result.path),[name]);assert.equal(await fs.readFile(path.join(result.path,name),'utf8'),'This is from '+name);
    }
   }else{
    assert.equal((await run({operation:'test',path:source,password:'password'})).count,4);
    const output=await run({operation:'extract',path:source,parent:root,password:'password'});for(const entry of listing.entries)assert.equal(await fs.readFile(path.join(output.path,entry.name),'utf8'),'This is from '+entry.name);
   }
  }
  const families=[{base:'test_rar_multivolume_single_file',parts:3,digits:1,expected:[['LibarchiveAddingTest.html','ee16390e87152d7dec632ae2b37566da6135966e46b5166e6f40a1c827fa61ad']]},
   {base:'test_read_format_rar5_multiarchive',parts:8,digits:2,expected:[['home/antek/temp/build/unrar5/libarchive/bin/bsdcat_test','b858933c12f1b907dac93a9428ae266c9fcb95df5cb88586fcd752a05305e1eb'],['home/antek/temp/build/unrar5/libarchive/bin/bsdtar_test','30e80423a3ed56cfc27d6fd79e3b40c087d42829aecaec01262e3727762bb2eb']]}];
  for(const family of families){
   const part=index=>path.join(root,`${family.base}.part${String(index).padStart(family.digits,'0')}.rar`),source=part(1);
   const listing=await run({operation:'list',path:source,browse});assert.equal(listing.total,family.expected.length);
   assert.equal((await run({operation:'test',path:source})).count,family.expected.length);
   const output=await run({operation:'extract',path:source,parent:root,revision:listing.revision});
   for(const [name,expected] of family.expected)assert.equal(hash(await fs.readFile(path.join(output.path,name))),expected);
   // Independent 7-Zip 25.01 extraction supplied the expected output hashes;
   // no external tool or network is required by this regression test.
   await assert.rejects(run({operation:'list',path:part(2)}),/第一个分卷/);
   const selected=await run({operation:'extract',path:source,parent:root,selected:[listing.entries[0].index]});assert.equal(hash(await fs.readFile(path.join(selected.path,family.expected[0][0]))),family.expected[0][1]);
   for(const index of [2,family.parts]){
    const missing=part(index),saved=missing+'.saved';await fs.rename(missing,saved);
    try{
     for(const operation of ['list','test']){const result=native(operation,source);assert.equal(result.status,2);assert.match(result.last.message,/Missing volume/);assert(!result.messages.some(message=>['meta','entry','result'].includes(message.type)),'incomplete volumes must never expose a successful prefix');}
     await assert.rejects(run({operation:'list',path:source,browse}),error=>error.code==='archive'&&error.message.includes('缺少 RAR 分卷')&&error.message.includes(path.basename(missing)));
     const destination=path.join(root,family.base+'-missing-'+index);await fs.mkdir(destination);await assert.rejects(run({operation:'extract',path:source,parent:destination}),/缺少 RAR 分卷/);assert.deepEqual(await fs.readdir(destination),[]);
    }finally{await fs.rename(saved,missing);}
   }
   const last=part(family.parts),original=await fs.readFile(last);await fs.writeFile(last,original.subarray(0,Math.floor(original.length/2)));
   try{await assert.rejects(run({operation:'test',path:source}),/RAR 头部|缺少 RAR 分卷|failed/);}finally{await fs.writeFile(last,original);}
   const renamed=path.join(root,'中文路径 '+family.digits);await fs.mkdir(renamed);for(let index=1;index<=family.parts;index++)await fs.copyFile(part(index),path.join(renamed,`资料.part${String(index).padStart(family.digits,'0')}.rar`));
   assert.equal((await run({operation:'test',path:path.join(renamed,`资料.part${'1'.padStart(family.digits,'0')}.rar`)})).count,family.expected.length);
  }
  const comment='RAR5 中文备注\nsecond line',source=path.join(root,'comment.rar');
  await fs.writeFile(source,Buffer.concat([Buffer.from('526172211a070100','hex'),block(Buffer.from([1,0,0])),record(3,'CMT',comment),record(2,'文档.txt','contents'),block(Buffer.from([5,0,0]))]));
  for(const query of [undefined,browse]){const listing=await run({operation:'list',path:source,browse:query});assert.equal(listing.comment,comment);assert.equal(listing.entries[0].name,'文档.txt');assert.equal(listing.total,1);}
  assert.equal((await run({operation:'test',path:source})).count,1);const extracted=await run({operation:'extract',path:source,parent:root});assert.equal(await fs.readFile(path.join(extracted.path,'文档.txt'),'utf8'),'contents');
  const later=path.join(root,'renamed.R00');await fs.copyFile(source,later);await assert.rejects(run({operation:'list',path:later}),/第一个分卷/);
  for(const fixture of manifest.files)assert.equal(hash(await fs.readFile(path.join(root,fixture.name))),fixture.sha256,'source archives remain unchanged');
  assert(!(await fs.readdir(root)).some(name=>/^\.one-(extract|archive)-/.test(name)));
  console.log('RAR compatibility passed: RAR4/5 encrypted headers, solid and mixed passwords, complete/missing/truncated volumes, first-volume guards, Chinese volume names, selective extraction and RAR5 UTF-8 comments.');
 }finally{if(service)await service.stop();for(const key of ['TEMP','TMP'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
