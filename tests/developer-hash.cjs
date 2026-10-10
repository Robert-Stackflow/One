const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,readFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {build}=require('esbuild');

test('text and file hashes match Node digests and validate expected values',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'developer-hash-'));
 try{
  await build({entryPoints:['src/main/developer-hash-service.ts'],outfile:join(root,'hash.cjs'),bundle:true,platform:'node',target:'node22'});
  const {DeveloperHashService}=require(join(root,'hash.cjs')),service=new DeveloperHashService();
  const expected=createHash('sha256').update('abc').digest('hex');const text=await service.start(1,{kind:'text',text:'abc',algorithm:'sha256',expected:expected.toUpperCase()},()=>{});
  assert.equal(text.digest,expected);assert.equal(text.match,true);assert.equal(text.bytes,3);
  const mismatch=await service.start(1,{kind:'text',text:'abc',algorithm:'md5',expected:'0'.repeat(32)},()=>{});assert.equal(mismatch.match,false);
  await assert.rejects(service.start(1,{kind:'text',text:'abc',algorithm:'sha256',expected:'xyz'},()=>{}),/校验值/);
  const file=join(root,'bytes.bin'),data=randomBytes(1024*1024+17);await writeFile(file,data);const updates=[];
  const result=await service.start(2,{kind:'file',path:file,algorithm:'sha512',expected:createHash('sha512').update(data).digest('hex')},value=>updates.push(value));
  assert.equal(result.match,true);assert.equal(result.bytes,data.length);assert(updates.at(-1).processed===data.length);assert((await readFile(file)).equals(data));assert.equal(service.pendingTasks,false);
  const large=join(root,'large.bin');await writeFile(large,Buffer.alloc(8*1024*1024,0x5a));const pending=service.start(3,{kind:'file',path:large,algorithm:'sha256'},()=>{});assert.equal(service.cancel(3),true);await assert.rejects(pending,/已取消/);assert.equal(service.pendingTasks,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
