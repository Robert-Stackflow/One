const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const Module=require('node:module');
const {spawn}=require('node:child_process');
const {build}=require('esbuild');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const end=u32(0x08e28222),extra=(id,data)=>Buffer.concat([u32(id),Buffer.from([0]),u16(data.length),data]);
function stored(files,solid=false){
 const root=Buffer.concat([u32(0x41474745),u16(256),u32(1),u32(0),...(solid?[extra(0x24e5a060,Buffer.alloc(0))]:[]),end]);
 const headers=files.map(([name,data],i)=>Buffer.concat([u32(0x0a8590e3),u32(i),u64(data.length),extra(0x0a8591ac,Buffer.from(name)),end]));
 const block=data=>Buffer.concat([u32(0x02b50c13),Buffer.from([0,0]),u32(data.length),u32(data.length),u32(zlib.crc32(data)),end,data]);
 return Buffer.concat([root,...(solid?[...headers,block(Buffer.concat(files.map(x=>x[1])))]:files.flatMap((x,i)=>[headers[i],block(x[1])])),end]);
}
function unicodeEncrypted(password,plain){
 const base=stored([['payload.txt',plain]]),salt=Buffer.from('0123456789abcdef'),derived=crypto.pbkdf2Sync(Buffer.from(password),salt,1000,66,'sha1');
 const counters=Buffer.alloc(Math.ceil(plain.length/16)*16);for(let i=0;i<counters.length/16;++i)counters.writeUInt32LE(i+1,i*16);
 const aes=crypto.createCipheriv('aes-256-ecb',derived.subarray(0,32),null);aes.setAutoPadding(false);const stream=Buffer.concat([aes.update(counters),aes.final()]),ciphertext=Buffer.from(plain.map((b,i)=>b^stream[i]));
 const mac=crypto.createHmac('sha1',derived.subarray(32,64)).update(ciphertext).digest().subarray(0,10),metadata=extra(0x08d1470f,Buffer.concat([Buffer.from([2]),salt,derived.subarray(64),mac]));
 const headerEnd=18+16+7+Buffer.byteLength('payload.txt'),blockData=headerEnd+4+22;
 return Buffer.concat([base.subarray(0,headerEnd),metadata,base.subarray(headerEnd,blockData),ciphertext,end]);
}
async function load(source){const result=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-egg-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function native(args,password='',env={},tail=Buffer.alloc(0)){
 return new Promise((resolve,reject)=>{const child=spawn(path.resolve('dist/native/One.Archive.exe'),args,{windowsHide:true,env:{...process.env,...env}});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),60000);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,events:stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)),stderr});});
  const bytes=Buffer.from(password);child.stdin.on('error',()=>{});child.stdin.end(Buffer.concat([u32(bytes.length),bytes,tail]));});
}
function externalAttributeHashes(data){
 const sums=[];let p=18;
 while(p<data.length){const id=data.readUInt32LE(p);p+=4;if(id===0x08e28222)break;
  if(id===0x0a8590e3){p+=12;while(data.readUInt32LE(p)!==0x08e28222){p+=4;const flags=data[p++],n=flags&1?data.readUInt32LE(p):data.readUInt16LE(p);p+=flags&1?4:2;p+=n;}p+=4;}
  else if(id===0x02b50c13){const n=data.readUInt32LE(p+6),crc=data.readUInt32LE(p+10);p+=18;const plain=zlib.inflateRawSync(data.subarray(p,p+n));assert.equal(zlib.crc32(plain),crc);sums.push(hash(plain));p+=n;}
  else assert.fail('Unexpected attributes fixture header');
 }
 sums.splice(3,0,hash(Buffer.alloc(0)));return sums;
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-egg-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;const results=[];
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{preparePreview}=await load('src/main/preview-service.ts'),{parseCli}=await load('src/main/archive-cli.ts'),{isArchivePath}=await load('src/shared/archive-actions.ts');
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request),browse={directory:'',search:'',flat:true};
  const folder=path.resolve('tests/fixtures/archives/egg'),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  for(const fixture of manifest.fixtures){
   const source=path.join(folder,fixture.name),request={path:source,password:fixture.password||'',encoding:0},data=await fs.readFile(source);assert.equal(hash(data),fixture.sha256);assert(isArchivePath(source));checks+=2;
   if(fixture.oracleStatus==='output-limit'){const result=await native(['test',source],request.password,{ONE_ARCHIVE_EXTRACT_MAX_BYTES:'1024'});assert.equal(result.events.at(-1)?.code,'resource');checks++;continue;}
   const listing=await run({...request,operation:'list',browse});assert.equal(listing.editable,false);assert.equal(listing.entries.length,listing.total);listing.entries.sort((a,b)=>a.index-b.index);checks++;
   if(fixture.result.entries){assert.deepEqual(listing.entries.map(x=>[x.name.replaceAll('\\','/'),x.size,x.encrypted]),fixture.result.entries.map(x=>[x.name,x.size,x.encrypted]));checks++;}
   const first=listing.entries.find(x=>!x.directory),details=await run({...request,operation:'details',index:first.index,revision:listing.revision});assert.equal(details.details.entry.name,first.name);assert.match(details.details.method,/Store|Deflate|BZip2|AZO|LZMA/);assert.equal(details.details.packedShared,!!fixture.result.solid);checks++;
   assert.equal((await run({...request,operation:'test'})).count,listing.total);checks++;
   const parent=path.join(root,fixture.name+'.out');await fs.mkdir(parent);const extract={...request,operation:'extract',parent,destination:'here',revision:listing.revision};let result=await run(extract);
   if(result.risk){assert(result.risk.nested>=1);assert.deepEqual(await fs.readdir(parent),[]);result=await run({...extract,riskApproval:{revision:result.risk.revision,maxBytes:64*1024**3,maxMilliseconds:30*60000}});checks++;}
   assert(result.count>=listing.total,fixture.name);checks++;
   const payloads=await Promise.all(listing.entries.map(x=>x.directory?Buffer.alloc(0):fs.readFile(path.join(parent,x.name))));
   for(let i=0;i<payloads.length;++i)assert.equal(payloads[i].length,listing.entries[i].size);
   const expected=fixture.oracleStatus==='decoded'?fixture.result.entries.map(x=>x.sha256):fixture.oracleStatus==='known-crc-failure'?['a8a2f6ebe286697c527eb35a58b5539532e9b3ae3b64d4eb0a46fb657b41562c']:externalAttributeHashes(data);
   assert.deepEqual(payloads.map(hash),expected,fixture.name);checks++;
   const preview=await preparePreview(source,()=>{throw Error('Unexpected raw preview');},async()=>undefined);assert.equal(preview.nativeArchive,true);checks++;
   if(fixture.password){for(const password of ['','incorrect'])await assert.rejects(run({...request,operation:'test',password}),error=>error.code==='password');checks+=2;}
   results.push({name:fixture.name,entries:listing.total,sha256:payloads.map(hash)});
  }
  // Open a later volume, then change only that volume and reject the old selection.
  const vol1=path.join(root,'number.vol1.egg'),vol2=path.join(root,'number.vol2.egg');for(const name of ['number.vol1.egg','number.vol2.egg'])await fs.copyFile(path.join(folder,name),path.join(root,name));
  const later=await run({operation:'list',path:vol2,browse});assert.equal((await run({operation:'test',path:vol2})).count,1);checks++;
  const laterOutput=path.join(root,'later-volume');await fs.mkdir(laterOutput);await run({operation:'extract',path:vol2,revision:later.revision,parent:laterOutput,destination:'here'});
  const laterEntry=later.entries.find(x=>!x.directory);assert.equal(hash(await fs.readFile(path.join(laterOutput,laterEntry.name))),manifest.fixtures.find(x=>x.name==='number.vol1.egg').result.entries[0].sha256);checks++;
  const live=await run({operation:'list',path:vol1,browse}),changed=await fs.readFile(vol2);changed[changed.length-7]^=1;await fs.writeFile(vol2,changed);
  const target=path.join(root,'changed-volume');await fs.mkdir(target);await fs.writeFile(path.join(target,'sentinel'),'keep');await assert.rejects(run({operation:'extract',path:vol1,revision:live.revision,parent:target,destination:'here'}),/changed|变化/i);assert.deepEqual(await fs.readdir(target),['sentinel']);checks++;
  await fs.unlink(vol2);await assert.rejects(run({operation:'list',path:vol1}),/volume.*missing/i);checks++;
  // Selection crosses solid block/file boundaries and consumes unselected data.
  const solid=path.join(folder,'solid.egg'),solidListing=await run({operation:'list',path:solid,browse}),selectedParent=path.join(root,'selected');await fs.mkdir(selectedParent);
  assert((await run({operation:'extract',path:solid,selected:[1],revision:solidListing.revision,parent:selectedParent,destination:'here'})).count>=1);assert.deepEqual(await fs.readdir(path.join(selectedParent,'s')),['lorem_ipsum_short2.txt']);checks++;
  const selectedFolder=path.join(root,'folder');await fs.mkdir(selectedFolder);assert((await run({operation:'extract',path:solid,selectedFolders:['s/'],revision:solidListing.revision,parent:selectedFolder,destination:'here'})).count>=2);checks++;
  // Corruption must never publish over a destination that already exists.
  const encrypted=await fs.readFile(path.join(folder,'test256.egg')),encryptionAt=encrypted.indexOf(u32(0x08d1470f));assert(encryptionAt>0);
  const badMac=Buffer.from(encrypted);badMac[encryptionAt+7+1+16+2]^=1;
  const hostile=[['mac',badMac,'password12345!'],['crc',(()=>{const b=stored([['safe.txt',Buffer.from('hello')]]);b[b.indexOf(u32(0x02b50c13))+14]^=1;return b;})(),''],
   ...['../escape.txt','C:/absolute.txt','safe.txt:stream','CON.txt'].map(name=>['path-'+name.replace(/\W/g,'_'),stored([[name,Buffer.from('bad')]]),'']),
   ['collision',stored([['a.txt',Buffer.from('a')],['A.TXT',Buffer.from('b')]]),''],['file-folder',stored([['a',Buffer.from('a')],['a/b',Buffer.from('b')]]),'']];
  const safe=stored([['safe.txt',Buffer.from('hello')]]),nameEnd=18+16+7+Buffer.byteLength('safe.txt');
  for(const [label,attributes] of [['link',8],['unknown-attributes',32]])hostile.push([label,Buffer.concat([safe.subarray(0,nameEnd),extra(0x2c86950b,Buffer.concat([u64(0),Buffer.from([attributes])])),safe.subarray(nameEnd)]),'']);
  const parentFlag=Buffer.from(safe);parentFlag[18+16+4]=16;hostile.push(['parent-flag',Buffer.concat([parentFlag.subarray(0,18+16+7),u32(0),parentFlag.subarray(18+16+7)]),'']);
  for(const [name,data,password] of hostile){const source=path.join(root,name+'.egg'),parent=path.join(root,name+'.out');await fs.writeFile(source,data);await fs.mkdir(parent);await fs.writeFile(path.join(parent,'sentinel'),'keep');await assert.rejects(run({operation:'extract',path:source,parent,destination:'here',password}));assert.deepEqual(await fs.readdir(parent),['sentinel']);checks++;}
  const synthetic=path.join(root,'selection.egg');await fs.writeFile(synthetic,stored([['one',Buffer.from('abc')],['two',Buffer.from('def')]],true));
  const budget=await native(['test',synthetic],'',{ONE_ARCHIVE_EXTRACT_MAX_BYTES:'4'});assert.equal(budget.events.at(-1)?.code,'resource');checks++;
  const folders=path.join(root,'folders.egg');await fs.writeFile(folders,stored([['a/zero',Buffer.alloc(0)],['a/file',Buffer.from('abc')],['b/file',Buffer.from('def')]],true));const folderListing=await run({operation:'list',path:folders,browse}),folderOutput=path.join(root,'folder-only');await fs.mkdir(folderOutput);
  await run({operation:'extract',path:folders,selectedFolders:['a/'],revision:folderListing.revision,parent:folderOutput,destination:'here'});assert.deepEqual(await fs.readdir(folderOutput),['a']);assert.equal((await fs.stat(path.join(folderOutput,'a/zero'))).size,0);assert.equal(await fs.readFile(path.join(folderOutput,'a/file'),'utf8'),'abc');checks++;
  const unicode=path.join(root,'unicode-password.egg'),unicodePassword='汉字🔐 päss',plain=Buffer.from('independent AES UTF-8 password');await fs.writeFile(unicode,unicodeEncrypted(unicodePassword,plain));
  assert.equal((await run({operation:'test',path:unicode,password:unicodePassword,encoding:949})).count,1);const unicodeOutput=path.join(root,'unicode-out');await fs.mkdir(unicodeOutput);await run({operation:'extract',path:unicode,password:unicodePassword,encoding:949,parent:unicodeOutput,destination:'here'});assert.deepEqual(await fs.readFile(path.join(unicodeOutput,'payload.txt')),plain);checks++;
  // Drag invokes the same verified decoder and returns the selected file only.
  const packet=Buffer.concat([u32(1),u32(1),Buffer.from([1])]),drag=await native(['drag-test',solid,path.join(root,'drag-stage'),'0',solidListing.revision],'',{ONE_TEST_MODE:'1'},packet);
  assert.equal(drag.code,0,JSON.stringify(drag.events));const dragged=drag.events.filter(x=>x.type==='drag-entry');assert.equal(dragged.length,1);assert.equal(dragged[0].bytes,525);checks++;
  assert.equal(parseCli(['test',solid],root).jobs[0].request.path,solid);assert.equal(parseCli(['list','--encoding','949',path.join(folder,'small_kor.egg')],root).jobs[0].request.encoding,949);checks+=2;
  await assert.rejects(run({operation:'create',path:path.join(root,'new.egg'),sources:[solid]}),/不支持/);await assert.rejects(run({operation:'update',path:solid,revision:solidListing.revision,changes:[{kind:'delete',indexes:[0]}]}),/ZIP 和 7Z/);checks+=2;
  assert.equal(later.total,live.total);assert.equal((await run({operation:'list',path:path.join(folder,'globalcomment.egg')})).comment,'Global comment');checks++;
  const evidence=path.resolve('verification/archive-egg');await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'latest.json'),JSON.stringify({date:new Date().toISOString(),checks,fixtures:results.length,results},null,2)+'\n');
  console.log(`EGG product passed: ${checks} checks, ${results.length} external datasets, exact hashes, solid selection, linked volumes/revisions, passwords, safety/cleanup, preview, drag and CLI.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
