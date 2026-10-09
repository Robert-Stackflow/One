const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const {spawnSync}=require('node:child_process'),{build}=require('esbuild'),iconv=require('iconv-lite'),koffi=require('koffi');
const acp=koffi.load('kernel32.dll').func('uint32_t __stdcall GetACP()')(),hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const codec=encoding=>(encoding||acp)===65001?'utf8':'cp'+(encoding||acp);
async function load(file){const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}),name=path.resolve('dist/main/zipx-password-test.cjs'),mod=new Module(name);mod.filename=name;mod.paths=module.paths;mod._compile(result.outputFiles[0].text,name);return mod.exports;}
// Independent WinZip AES byte encoder. Authenticate the pinned original before
// rekeying its compressed payload, preserving the external codec's exact bytes.
function rekey(original,oldPassword,password,encoding){
 const bytes=Buffer.from(original),end=bytes.length-22;assert.equal(bytes.readUInt32LE(end),0x06054b50);assert.equal(bytes.readUInt16LE(end+10),1);
 const central=bytes.readUInt32LE(end+16),local=bytes.readUInt32LE(central+42),packed=bytes.readUInt32LE(central+20);assert.equal(bytes.readUInt16LE(central+10),99);
 let at=central+46+bytes.readUInt16LE(central+28),stop=at+bytes.readUInt16LE(central+30),strength;
 while(at<stop){const id=bytes.readUInt16LE(at),size=bytes.readUInt16LE(at+2);if(id===0x9901)strength=bytes[at+8];at+=4+size;}assert([1,3].includes(strength));
 const keySize=strength===1?16:32,saltSize=keySize/2,data=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),body=data+saltSize+2,tag=data+packed-10;
 const derive=(password,salt)=>crypto.pbkdf2Sync(password,salt,1000,keySize*2+2,'sha1');
 const old=derive(Buffer.from(oldPassword),bytes.subarray(data,data+saltSize));assert.deepEqual(old.subarray(keySize*2),bytes.subarray(body-2,body));
 const mac=(key,cipher)=>crypto.createHmac('sha1',key.subarray(keySize,keySize*2)).update(cipher).digest().subarray(0,10);
 assert.deepEqual(mac(old,bytes.subarray(body,tag)),bytes.subarray(tag,tag+10));
 const transform=(input,key)=>{const result=Buffer.alloc(input.length),aes=crypto.createCipheriv('aes-'+keySize*8+'-ecb',key.subarray(0,keySize),null);aes.setAutoPadding(false);for(let offset=0;offset<input.length;offset+=16){const counter=Buffer.alloc(16);counter.writeUInt32LE(offset/16+1);const mask=aes.update(counter);for(let i=0;i<Math.min(16,input.length-offset);i++)result[offset+i]=input[offset+i]^mask[i];}assert.equal(aes.final().length,0);return result;};
 const encoded=iconv.encode(password,codec(encoding));assert.equal(iconv.decode(encoded,codec(encoding)),password);
 const salt=crypto.createHash('sha256').update(original).update(String(encoding)).digest().subarray(0,saltSize),key=derive(encoded,salt),cipher=transform(transform(bytes.subarray(body,tag),old),key);
 salt.copy(bytes,data);key.subarray(keySize*2).copy(bytes,body-2);cipher.copy(bytes,body);mac(key,cipher).copy(bytes,tag);return bytes;
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-zipx-password-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{parseCli,runCli}=await load('src/main/archive-cli.ts'),{previewArchive}=await load('src/main/preview-archive.ts');service=new ArchiveService(path.join(root,'cache'),()=>{});const run=async request=>{try{return await service.run(1,request);}catch(error){error.message=path.basename(request.path)+': '+error.message;throw error;}};
  const cases=[[437,' café £ '],[932,' 日本語 あ '],[936,' 中文 密码 '],[949,' 한국어 암호 '],[950,' 中文 密碼 '],[65001,' 中文 한국어 🔒 ']];cases.push([0,cases.find(([code])=>code===acp)?.[1]||' system password ']);
  const fixtureRoot=path.resolve('tests/fixtures/archives/encrypted-zip');let sequence=0;
  for(const manifestName of ['manifest.json','sevenzip-manifest.json','zstd-manifest.json']){const manifest=JSON.parse(await fs.readFile(path.join(fixtureRoot,manifestName),'utf8'));
   for(const fixture of manifest.files){const original=await fs.readFile(path.join(fixtureRoot,fixture.stored));assert.equal(hash(original),fixture.sha256);
    for(const [passwordEncoding,password] of cases){
     const source=path.join(root,sequence+++'-'+passwordEncoding+'.zipx'),bytes=rekey(original,manifest.password,password,passwordEncoding);await fs.writeFile(source,bytes);
     const listing=await run({operation:'list',path:source,password,passwordEncoding});assert.equal(listing.total,1);assert.equal(listing.entries[0].encrypted,true);checks++;
     await run({operation:'test',path:source,password,passwordEncoding});const parent=path.join(root,'out-'+sequence);await fs.mkdir(parent);await run({operation:'extract',path:source,password,passwordEncoding,parent,destination:'here',selected:[listing.entries[0].index]});assert.equal(hash(await fs.readFile(path.join(parent,fixture.expected.name))),fixture.expected.sha256);checks+=2;
     await assert.rejects(run({operation:'test',path:source,password:'wrong',passwordEncoding}),error=>['password','archive'].includes(error.code));checks++;
     if(!iconv.encode(password,codec(passwordEncoding)).equals(Buffer.from(password))){await assert.rejects(run({operation:'test',path:source,password}),error=>['password','archive'].includes(error.code));checks++;}
     const selection=Buffer.alloc(9);selection.writeUInt32LE(1);selection.writeUInt32LE(0,4);selection[8]=1;const secret=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(secret.length);
     const drag=spawnSync(path.resolve('dist/native/One.Archive.exe'),['drag-test',source,path.join(root,'drag-'+sequence),'0',listing.revision],{input:Buffer.concat([header,secret,selection]),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536,env:{...process.env,ONE_TEST_MODE:'1',ONE_ARCHIVE_PASSWORD_ENCODING:String(passwordEncoding)}});assert.equal(drag.status,0,drag.stdout+drag.stderr);assert(drag.stdout.includes('"bytes":'+fixture.expected.bytes));checks++;
     if(manifestName==='sevenzip-manifest.json'&&fixture.method===12){
      const lines=[],code=await runCli(parseCli(['test','--password-stdin','--password-encoding',passwordEncoding===0?'system':String(passwordEncoding),'--json',source],root),service,{out:async line=>lines.push(line),err:async line=>lines.push(line),signal:new AbortController().signal,password:async()=>password});assert.equal(code,0,lines.join('\n'));checks++;
      const preview={type:'archive',path:source};const view=await previewArchive(()=>preview,{path:source,password,passwordEncoding},crypto.randomUUID(),(request,id)=>service.run(2,request,id));assert.equal(view.total,1);checks++;
      if(passwordEncoding===949||passwordEncoding===65001){const standalone=spawnSync(path.resolve('dist/native/One.Cli.exe'),['test','--password-stdin','--password-encoding',String(passwordEncoding),'--json',source],{input:password+'\n',encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536,env:{...process.env,ONE_DATA_DIR:path.join(root,'cli-profile')}});assert.equal(standalone.status,0,standalone.stdout+standalone.stderr);assert(standalone.stdout.includes('"type":"result"'));checks++;}
     }
    }
   }
  }
  const advanced=path.join(fixtureRoot,'sevenzip-aes256-bzip2.zipx');await assert.rejects(run({operation:'test',path:advanced,password:'中文 🔒',passwordEncoding:437}),error=>error.code==='password'&&/represented/.test(error.message));checks++;
  assert.throws(()=>parseCli(['test','--password-encoding','936','example.7z'],root),/ZIP/);checks++;
  // JAR/APK use the same ZIP handler and must accept the explicit code page.
  const fixture=JSON.parse(await fs.readFile(path.join(fixtureRoot,'sevenzip-manifest.json'),'utf8')).files[0],original=await fs.readFile(path.join(fixtureRoot,fixture.stored));
  for(const ext of ['jar','apk']){const source=path.join(root,'alias.'+ext);await fs.writeFile(source,rekey(original,'secret',' 한국어 암호 ',949));await run({operation:'test',path:source,password:' 한국어 암호 ',passwordEncoding:949});checks++;}
  console.log(`ZIPX password encoding passed: ${checks} checks, ten external codec/AES fixtures including ZSTD, UTF8+emoji, system ACP ${acp}, CP437/932/936/949/950, extraction hashes, wrong encoding/password, drag, CLI, preview and JAR/APK.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
module.exports={rekey};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
