const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {spawnSync,execFileSync}=require('node:child_process');
const {build}=require('esbuild');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function load(){const built=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const name=path.resolve('dist/main/archive-authentication-test.cjs'),mod=new Module(name);mod.filename=name;mod.paths=module.paths;mod._compile(built.outputFiles[0].text,name);return mod.exports;}
async function closeProbe(root){
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');const installation=execFileSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',windowsHide:true}).trim();assert(installation);
 const command=path.join(root,'build-close-probe.cmd'),exe=path.join(root,'close-probe.exe');const quote=file=>'"'+path.resolve(file)+'"';
 await fs.writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /I${quote('vendor/archive/minizip-ng')} /I${quote('work/archive-build/minizip-ng')} ${quote('tests/archive-authentication-native.cpp')} /Fo:${quote(path.join(root,'close-probe.obj'))} /Fe:${quote(exe)} /link ${quote('work/archive-build/minizip-ng/Release/minizip-ng.lib')} ${quote('work/archive-build/zlib/Release/zlibstatic.lib')} ${quote('work/archive-build/xz/Release/lzma.lib')} advapi32.lib bcrypt.lib crypt32.lib\r\n`);
 execFileSync('cmd.exe',['/d','/c',command],{windowsHide:true,encoding:'utf8',maxBuffer:128*1024});return (source,index,password='secret')=>JSON.parse(execFileSync(exe,[source,String(index),password],{encoding:'utf8',windowsHide:true,maxBuffer:8192}));
}
function directory(bytes){
 let end=bytes.length-22;while(end>=Math.max(0,bytes.length-65557)&&(bytes.readUInt32LE(end)!==0x06054b50||end+22+bytes.readUInt16LE(end+20)!==bytes.length))end--;assert(end>=0);
 const count=bytes.readUInt16LE(end+10),entries=[];let offset=bytes.readUInt32LE(end+16);assert(offset<0xffffffff);
 const aes=(at,size)=>{for(let stop=at+size;at+4<=stop;){const id=bytes.readUInt16LE(at),length=bytes.readUInt16LE(at+2);assert(at+4+length<=stop);if(id===0x9901){assert.equal(length,7);return at+4;}at+=4+length;}return null;};
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);const nameSize=bytes.readUInt16LE(offset+28),extraSize=bytes.readUInt16LE(offset+30),commentSize=bytes.readUInt16LE(offset+32),packed=bytes.readUInt32LE(offset+20),local=bytes.readUInt32LE(offset+42);assert(local<0xffffffff&&packed<0xffffffff);
  const name=bytes.subarray(offset+46,offset+46+nameSize).toString('utf8');assert.equal(bytes.readUInt32LE(local),0x04034b50);const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),data=local+30+localName+localExtra;
  entries.push({name,central:offset,local,data,packed,aes:aes(offset+46+nameSize,extraSize),localAes:aes(local+30+localName,localExtra)});offset+=46+nameSize+extraSize+commentSize;
 }
 return entries;
}
function nativeDrag(source,stage,revision,index){
 const secret=Buffer.from('secret'),header=Buffer.alloc(4);header.writeUInt32LE(secret.length);const selection=Buffer.alloc(9);selection.writeUInt32LE(1);selection.writeUInt32LE(index,4);selection[8]=1;
 const result=spawnSync(path.resolve('dist/native/One.Archive.exe'),['drag-test',source,stage,'0',revision],{windowsHide:true,env:{...process.env,ONE_TEST_MODE:'1'},input:Buffer.concat([header,secret,selection]),encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert(!result.error,result.error?.message);return result;
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-auth-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;
 try{
  const {ArchiveService}=await load();service=new ArchiveService(path.join(root,'cache'),()=>{});const run=async request=>{try{return await service.run(1,request);}catch(error){error.message=`${request.operation} ${path.basename(request.path)}: ${error.message}`;throw error;}},input=path.join(root,'input');await fs.mkdir(input);
  const payload=Buffer.concat(Array.from({length:600},(_,i)=>crypto.createHash('sha256').update(String(i)).digest()));await fs.writeFile(path.join(input,'payload.bin'),payload);await fs.writeFile(path.join(input,'empty.txt'),'');await fs.writeFile(path.join(input,'中文.txt'),'Unicode payload');
  let sequence=0;const close=await closeProbe(root);
  const roundtrip=async(source)=>{
   await run({operation:'test',path:source,password:'secret'});const parent=path.join(root,'valid-'+sequence++);await fs.mkdir(parent);await run({operation:'extract',path:source,password:'secret',parent,destination:'here'});assert.equal(hash(await fs.readFile(path.join(parent,'input/payload.bin'))),hash(payload));assert.equal((await fs.readFile(path.join(parent,'input/empty.txt'))).length,0);checks+=2;
   const entries=directory(await fs.readFile(source)),index=entries.findIndex(item=>item.name.endsWith('payload.bin')),closed=close(source,index);assert.equal(closed.error,0);assert.equal(closed.read,payload.length);assert.equal(closed.size,payload.length);assert.equal(closed.packed,entries[index].packed);checks++;
  };
  const rejected=async(source,{drag=false,update=false}={})=>{
   const before=await fs.readFile(source);await assert.rejects(run({operation:'test',path:source,password:'secret'}),error=>error.code==='archive');const parent=path.join(root,'rejected-'+sequence++);await fs.mkdir(parent);await fs.writeFile(path.join(parent,'sentinel.txt'),'untouched');
   const index=directory(before).findIndex(item=>item.name.endsWith('payload.bin'));assert(close(source,index).error<0,'Descriptor output must not hide authentication/CRC failure');checks++;
   await assert.rejects(run({operation:'extract',path:source,password:'secret',parent,destination:'here'}),error=>error.code==='archive');assert.deepEqual(await fs.readdir(parent),['sentinel.txt']);assert.equal(await fs.readFile(path.join(parent,'sentinel.txt'),'utf8'),'untouched');checks+=2;
   if(drag||update){const listing=await run({operation:'list',path:source,browse:{directory:'',search:'',flat:true}}),entry=listing.entries.find(item=>item.name.endsWith('payload.bin'));assert(entry);
    if(drag){const result=nativeDrag(source,path.join(root,'bad-drag-'+sequence++),listing.revision,entry.index);assert.notEqual(result.status,0);assert(result.stdout.includes('"type":"error"'));checks++;}
    if(update){await assert.rejects(run({operation:'update',path:source,password:'secret',revision:listing.revision,changes:[{kind:'comment',text:'must not be saved'}]}),error=>error.code==='archive');checks++;}
   }
   assert.deepEqual(await fs.readFile(source),before);
  };
  for(const zipEncryption of ['aes256','zipcrypto'])for(const method of ['store','deflate','xz']){
   const source=path.join(root,zipEncryption+'-'+method+'.zip');await run({operation:'create',path:source,sources:[input],password:'secret',zipEncryption,zipMethod:method==='xz'?'xz':'deflate',level:method==='store'?0:6});await roundtrip(source);
   const bytes=await fs.readFile(source),entries=directory(bytes),entry=entries.find(item=>item.name.endsWith('payload.bin'));assert(entry);
   const validZipx=source+'x';await fs.writeFile(validZipx,bytes);await roundtrip(validZipx);
   if(zipEncryption==='aes256'){
    assert(entry.aes&&entry.localAes);assert.equal(bytes.readUInt16LE(entry.aes),1);
    const damaged=Buffer.from(bytes);damaged[entry.data+entry.packed-1]^=1;const bad=source.replace('.zip','-bad-tag.zip');await fs.writeFile(bad,damaged);await rejected(bad,{drag:true,update:true});await fs.writeFile(bad+'x',damaged);await rejected(bad+'x');
    const crc=Buffer.from(bytes);crc.writeUInt32LE((crc.readUInt32LE(entry.central+16)^1)>>>0,entry.central+16);crc.writeUInt32LE((crc.readUInt32LE(entry.local+14)^1)>>>0,entry.local+14);const badCrc=source.replace('.zip','-bad-crc.zip');await fs.writeFile(badCrc,crc);await rejected(badCrc);checks++;
    // AE-2 omits CRC. Preserve authenticated ciphertext/MAC, mark both AES
    // extras v2 and zero both CRC fields; every empty/nonempty entry is covered.
    const ae2=Buffer.from(bytes);for(const item of entries)if(item.aes){ae2.writeUInt16LE(2,item.aes);ae2.writeUInt16LE(2,item.localAes);ae2.writeUInt32LE(0,item.central+16);ae2.writeUInt32LE(0,item.local+14);if(ae2.readUInt16LE(item.local+6)&8){let descriptor=item.data+item.packed;if(ae2.readUInt32LE(descriptor)===0x08074b50)descriptor+=4;ae2.writeUInt32LE(0,descriptor);}}
    const ae2Path=source.replace('.zip','-ae2.zip');await fs.writeFile(ae2Path,ae2);await roundtrip(ae2Path);await fs.writeFile(ae2Path+'x',ae2);await roundtrip(ae2Path+'x');ae2[entry.data+entry.packed-1]^=1;const badAe2=source.replace('.zip','-ae2-bad-tag.zip');await fs.writeFile(badAe2,ae2);await rejected(badAe2);
   }else{
    assert.equal(entry.aes,null);const crc=Buffer.from(bytes);crc.writeUInt32LE((crc.readUInt32LE(entry.central+16)^1)>>>0,entry.central+16);crc.writeUInt32LE((crc.readUInt32LE(entry.local+14)^1)>>>0,entry.local+14);const bad=source.replace('.zip','-bad-crc.zip');await fs.writeFile(bad,crc);await rejected(bad,{drag:true,update:true});
    if(method==='store'){const damaged=Buffer.from(bytes);damaged[entry.data+12]^=1;const badData=source.replace('.zip','-bad-data.zip');await fs.writeFile(badData,damaged);await rejected(badData);}
   }
  }
  const fixtureRoot=path.resolve('tests/fixtures/archives/encrypted-zip');
  for(const manifestName of ['manifest.json','sevenzip-manifest.json']){
  const manifest=JSON.parse(await fs.readFile(path.join(fixtureRoot,manifestName),'utf8'));
  for(const fixture of manifest.files){
   const bytes=await fs.readFile(path.join(fixtureRoot,fixture.stored));assert.equal(bytes.length,fixture.bytes);assert.equal(hash(bytes),fixture.sha256);const entry=directory(bytes)[0];assert.equal(bytes.readUInt16LE(entry.aes),fixture.aesVersion);assert.equal(bytes[entry.aes+4],fixture.aesStrength);assert.equal(bytes.readUInt16LE(entry.aes+5),fixture.method);assert.equal(bytes.readUInt16LE(entry.local+6),fixture.flags);checks++;
   for(const extension of fixture.extensions||['.zip','.zipx']){
    const source=path.join(root,fixture.stored.replace(/\.zipx?$/,extension));await fs.writeFile(source,bytes);await run({operation:'test',path:source,password:manifest.password});const parent=path.join(root,'external-'+sequence++);await fs.mkdir(parent);await run({operation:'extract',path:source,password:manifest.password,parent,destination:'here'});const content=await fs.readFile(path.join(parent,fixture.expected.name));assert.equal(content.length,fixture.expected.bytes);assert.equal(hash(content),fixture.expected.sha256);checks++;
    if(fixture.nativeClose!==false){const closed=close(source,0,manifest.password);assert.equal(closed.error,0);assert.equal(closed.read,fixture.expected.bytes);assert.equal(closed.packed,entry.packed);checks++;}
    await assert.rejects(run({operation:'test',path:source,password:'incorrect'}));checks++;
    const damaged=Buffer.from(bytes);damaged[entry.data+entry.packed-1]^=1;const bad=source+'.bad'+extension;await fs.writeFile(bad,damaged);await assert.rejects(run({operation:'test',path:bad,password:manifest.password}),error=>error.code==='archive');if(fixture.nativeClose!==false)assert(close(bad,0,manifest.password).error<0);checks++;
   }
  }
  }
  console.log(`Archive authentication passed: ${checks} checks, AES AE-1/AE-2 MAC, AES/ZipCrypto CRC, Store/Deflate/XZ, empty files, ZIPX oracle, seven independent WinZip/7-Zip AES fixtures including BZIP2/LZMA/PPMd8, no publication, drag and update refusal.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
