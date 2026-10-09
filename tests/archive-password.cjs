const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const iconv=require('iconv-lite');
const koffi=require('koffi');
const acp=koffi.load('kernel32.dll').func('uint32_t __stdcall GetACP()')();
const helper=path.resolve('dist/native/One.Archive.exe');
const crcByte=(crc,byte)=>{crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);return crc>>>0;};
const crc32=bytes=>(bytes.reduce(crcByte,0xffffffff)^0xffffffff)>>>0;
// Independent traditional ZIP-encryption fixture. Its filename is UTF-8;
// the encryption key is derived from explicitly encoded password bytes.
function legacyZip(password,codepage,body){
 const name=Buffer.from('中文.txt'),crc=crc32(body),keys=[0x12345678,0x23456789,0x34567890];
 const update=byte=>{keys[0]=crcByte(keys[0],byte);keys[1]=(Math.imul((keys[1]+(keys[0]&255))>>>0,134775813)+1)>>>0;keys[2]=crcByte(keys[2],keys[1]>>>24);};
 for(const byte of iconv.encode(password,'cp'+codepage))update(byte);
 const plain=Buffer.concat([Buffer.alloc(12,42),body]);plain[11]=crc>>>24;
 const encrypted=Buffer.from(plain.map(byte=>{const t=(keys[2]|2)>>>0,value=byte^((Math.imul(t,t^1)>>>8)&255);update(byte);return value;}));
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x801,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(encrypted.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x801,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(encrypted.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+encrypted.length,16);
 return Buffer.concat([local,name,encrypted,central,name,end]);
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-password-'));
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP,ONE_ARCHIVE_PASSWORD_ENCODING:process.env.ONE_ARCHIVE_PASSWORD_ENCODING};let service;
 const seven=(args,expected=0)=>{const result=spawnSync('7z',args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024**2,env:{...process.env,TEMP:root,TMP:root}});assert.equal(result.status,expected,result.stdout+'\n'+result.stderr);return result;};
 const native=(args,password,packet=Buffer.alloc(0),encoding=65001,expected=0)=>{const secret=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(secret.length);const result=spawnSync(helper,args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:4*1024**2,input:Buffer.concat([header,secret,packet]),env:{...process.env,TEMP:root,TMP:root,ONE_TEST_MODE:'1',ONE_ARCHIVE_PASSWORD_ENCODING:String(encoding)}});assert.equal(result.status,expected,result.stdout+'\n'+result.stderr);return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 try{
  Object.assign(process.env,{TEMP:root,TMP:root,ONE_ARCHIVE_PASSWORD_ENCODING:'invalid inherited value'});seven(['i']);
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-cli.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-password-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{parseCli,runCli}=load('archive-cli');
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const source=path.join(root,'source.txt'),added=path.join(root,'added.txt'),body=Buffer.from('独立旧编码 ZIP 密码样本');await fs.writeFile(source,body);await fs.writeFile(added,'new content');
  const cases=[[437,' café £ '],[932,' 日本語 あ '],[936,' 兼容 密码 '],[950,' 相容 密碼 '],[65001,' 密码 🔒 ']];
  for(const [passwordEncoding,password] of cases){
   const file=path.join(root,'one-'+passwordEncoding+'.zip');await run({operation:'create',path:file,sources:[source],password,passwordEncoding});
   let listing=await run({operation:'list',path:file,password,passwordEncoding,browse:{directory:'',search:'',flat:false}});assert.equal(listing.entries[0].name,'source.txt');assert(listing.entries[0].encrypted);
   await run({operation:'test',path:file,password,passwordEncoding});await assert.rejects(run({operation:'test',path:file,password:'wrong',passwordEncoding}),error=>error.code==='password');
   if(passwordEncoding!==65001)await assert.rejects(run({operation:'test',path:file,password}),error=>error.code==='password');
   const result=await run({operation:'extract',path:file,parent:root,password,passwordEncoding,selected:[0]});assert.deepEqual(await fs.readFile(path.join(result.path,'source.txt')),body);
   await run({operation:'update',path:file,revision:listing.revision,password,passwordEncoding,changes:[{kind:'rename',index:0,name:'renamed.txt'},{kind:'add',source:added,name:'added.txt'}]});
   await run({operation:'test',path:file,password,passwordEncoding});listing=await run({operation:'list',path:file});assert.equal(listing.total,2);assert(listing.entries.every(item=>item.encrypted));
   const selection=Buffer.alloc(9);selection.writeUInt32LE(1);selection.writeUInt32LE(0,4);selection[8]=1;
   const dragged=native(['drag-test',file,path.join(root,'drag-'+passwordEncoding),'0',listing.revision],password,selection,passwordEncoding);assert(dragged.some(item=>item.type==='drag-entry'&&item.bytes===body.length));
   if(passwordEncoding===acp)seven(['t','-y','-p'+password,file]);
   if(passwordEncoding!==65001){
    const fixture=path.join(root,'legacy-'+passwordEncoding+'.zip');await fs.writeFile(fixture,legacyZip(password,passwordEncoding,body));
    await run({operation:'test',path:fixture,password,passwordEncoding});await assert.rejects(run({operation:'test',path:fixture,password}),error=>error.code==='password');
    const out=await run({operation:'extract',path:fixture,parent:root,password,passwordEncoding});assert.deepEqual(await fs.readFile(path.join(out.path,'中文.txt')),body);
    const before=await run({operation:'list',path:fixture});await run({operation:'update',path:fixture,revision:before.revision,password,passwordEncoding,changes:[{kind:'rename',index:0,name:'legacy-renamed.txt'},{kind:'add',source:added,name:'legacy-added.txt'}]});await run({operation:'test',path:fixture,password,passwordEncoding});
    if(passwordEncoding===acp)seven(['t','-y','-p'+password,fixture]);
   }
  }
  const systemPassword=cases.find(([code])=>code===acp)?.[1]??' system password ',system=path.join(root,'system.zip');
  await run({operation:'create',path:system,sources:[source],password:systemPassword,passwordEncoding:0});seven(['t','-y','-p'+systemPassword,system]);
  const systemListing=await run({operation:'list',path:system});
  const original=await fs.readFile(system);await assert.rejects(run({operation:'update',path:system,revision:systemListing.revision,password:'wrong',passwordEncoding:0,changes:[{kind:'delete',indexes:[0]}]}));assert.deepEqual(await fs.readFile(system),original);
  for(const value of [1,-1,1252,'936',null,true])await assert.rejects(run({operation:'test',path:system,passwordEncoding:value}),/编码/);
  for(const password of ['null\0suffix','long'.repeat(300),'invalid\ud800'])await assert.rejects(run({operation:'test',path:system,password}),/密码/);
  const impossible=path.join(root,'lossy.zip');await assert.rejects(run({operation:'create',path:impossible,sources:[source],password:'中文 🔒',passwordEncoding:437}),error=>error.code==='password'&&/represented/.test(error.message));await assert.rejects(fs.stat(impossible),{code:'ENOENT'});
  await assert.rejects(run({operation:'create',path:path.join(root,'invalid.7z'),sources:[source],password:'secret',passwordEncoding:936}),/ZIP/);
  const sevenFile=path.join(root,'unicode.7z');await run({operation:'create',path:sevenFile,sources:[source],password:' 密码 🔒 '});await run({operation:'test',path:sevenFile,password:' 密码 🔒 '});seven(['t','-y','-p 密码 🔒 ',sevenFile]);
  const ascii=path.join(root,'ascii.zip');await run({operation:'create',path:ascii,sources:[source],password:'Ascii 123'});for(const [passwordEncoding] of cases)await run({operation:'test',path:ascii,password:'Ascii 123',passwordEncoding});
  const random=path.join(root,'random.bin');await fs.writeFile(random,crypto.randomBytes(2500000));const split=path.join(root,'split.zip');await run({operation:'create',path:split,sources:[random],password:systemPassword,passwordEncoding:0,volumeBytes:1024**2});assert((await fs.readdir(root)).includes('split.z01'));seven(['t','-y','-p'+systemPassword,split]);await run({operation:'extract',path:split,parent:root,password:systemPassword,passwordEncoding:0});
  const cli=async args=>{const lines=[];const code=await runCli(parseCli(args,root),service,{out:async line=>lines.push(line),err:async()=>{},signal:new AbortController().signal,password:async()=>systemPassword});assert.equal(code,0,lines.join('\n'));return lines.map(line=>JSON.parse(line));};
  const cliZip=path.join(root,'cli.zip');await cli(['create','--output',cliZip,'--password-encoding','system','--password-stdin','--json',source]);seven(['t','-y','-p'+systemPassword,cliZip]);
  await cli(['test','--password-encoding=system','--password-stdin','--json',cliZip]);await cli(['extract','--output',root,'--password-encoding','system','--password-stdin','--json',cliZip]);
  const changes=path.join(root,'changes.json');await fs.writeFile(changes,JSON.stringify([{kind:'rename',index:0,name:'cli-renamed.txt'}]));await cli(['update','--changes',changes,'--password-encoding','system','--password-stdin','--json',cliZip]);seven(['t','-y','-p'+systemPassword,cliZip]);
  for(const args of [['test','--password-encoding','auto',system],['test','--password-encoding','936',sevenFile],['create','--output','invalid.7z','--password-encoding','system',source]])assert.throws(()=>parseCli(args,root));
  assert.equal(parseCli(['test',system],root).jobs[0].request.passwordEncoding,65001);
  assert.equal(parseCli(['test','--encoding','932','--password-encoding','936',system],root).jobs[0].request.encoding,932);
  assert.equal(native(['test',system,'0'],systemPassword,Buffer.alloc(0),'invalid',2).at(-1).code,'password');
  assert.equal(native(['test',system,'0'],'x\0suffix',Buffer.alloc(0),0,2).at(-1).code,'password');
  if(process.env.ONE_ARCHIVE_PASSWORD_CLI){
   const executable=path.resolve(process.env.ONE_ARCHIVE_PASSWORD_CLI),profile=path.join(root,'cli-profile');
   const actual=args=>{const result=spawnSync(executable,['archive',...args,'--json','--password-stdin'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024**2,input:systemPassword,env:{...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile}});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);return result.stdout.trim().split(/\r?\n/).map(JSON.parse);};
   const file=path.join(root,'actual-cli.zip');actual(['create','--output',file,'--password-encoding','system',source]);seven(['t','-y','-p'+systemPassword,file]);
   actual(['test','--password-encoding','system',file]);actual(['extract','--output',root,'--password-encoding','system',file]);actual(['update','--changes',changes,'--password-encoding','system',file]);seven(['t','-y','-p'+systemPassword,file]);
   assert.deepEqual(await fs.readdir(path.join(profile,'archive-cli/temp')),[]);assert(!(await fs.readFile(path.join(profile,'logs/cli.jsonl'),'utf8')).includes(systemPassword));
   console.log('Actual standalone CLI password-encoding roundtrip and log privacy passed.');
  }
  console.log('ZIP password encoding passed: UTF-8/default, system ACP '+acp+', CP437/932/936/950, independent traditional fixtures, AES, update, split, drag content, CLI, strict conversion and rollback; no Explorer windows.');
 }finally{
  await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
