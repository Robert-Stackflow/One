const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
const signature=Buffer.from('526172211a0700','hex');
function header(type,flags,length){const b=Buffer.alloc(length);b[2]=type;b.writeUInt16LE(flags,3);b.writeUInt16LE(length,5);return b;}
function stamp(b,length=b.length){b.writeUInt16LE(crc(b.subarray(2,length))&0xffff);return b;}
function file(type,name,data,options={}){
 const filename=Buffer.from(name),b=header(type,0x8000|(options.flags??0),32+filename.length);
 b.writeUInt32LE(data.length,7);b.writeUInt32LE(options.size??data.length,11);b[15]=2;b.writeUInt32LE(options.crc??crc(data),16);
 b[24]=options.version??29;b[25]=options.method??0x30;b.writeUInt16LE(filename.length,26);b.writeUInt32LE(options.unicode?1:0,28);filename.copy(b,32);
 return Buffer.concat([stamp(b),data]);
}
function old(data,options={}){
 const b=header(0x75,0,13);b.writeUInt16LE(13+data.length,5);b.writeUInt16LE(options.size??data.length,7);
 b[9]=options.version??29;b[10]=options.method??0x30;b.writeUInt16LE((options.crc??crc(data))&0xffff,11);
 return Buffer.concat([stamp(b),data]);
}
function archive(comment,legacy=false,prefix=Buffer.alloc(0)){
 const main=header(0x73,legacy?2:0,13);if(legacy)main.writeUInt16LE(13+comment.length,5);
 return Buffer.concat([prefix,signature,stamp(main),comment,file(0x74,'safe.txt',Buffer.from('contents')),stamp(header(0x7b,0,7))]);
}
async function load(source){const result=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const name=path.resolve('dist/main/rar-comment-test.cjs'),m=new Module(name);m.filename=name;m.paths=module.paths;m._compile(result.outputFiles[0].text,name);return m.exports;}
(async()=>{
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-rar-comments-'));let service;
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{previewArchive}=await load('src/main/preview-archive.ts');
  service=new ArchiveService(path.join(root,'cache'),()=>{});
  const run=request=>service.run(1,request).catch(error=>{error.message=`${path.basename(request.path)} ${request.operation}: ${error.message}`;throw error;});
  async function check(name,bytes,expected){
   const source=path.join(root,name+'.rar');await fs.writeFile(source,bytes);
   for(const browse of [undefined,{directory:'',search:'',flat:false},{directory:'',search:'safe',flat:true}]){
    const result=await run({operation:'list',path:source,browse});assert.equal(result.comment,expected);assert.equal(result.total,1);assert.equal(result.entries[0].name,'safe.txt');
   }
   const data={path:source,type:'archive'};
   const listing=await previewArchive(()=>data,{path:source},crypto.randomUUID(),(request,id)=>service.run(2,request,id));assert.equal(listing.comment,expected);
   assert.equal((await run({operation:'test',path:source})).count,1);
   const output=await run({operation:'extract',path:source,parent:root});assert.deepEqual(await fs.readdir(output.path),['safe.txt']);assert.equal(await fs.readFile(path.join(output.path,'safe.txt'),'utf8'),'contents');
   assert.deepEqual(await fs.readFile(source),bytes);return source;
  }
  const unicode='RAR4 中文备注 🗃\r\n第二行';
  await check('unicode',archive(file(0x7a,'CMT',Buffer.from(unicode,'utf16le'),{unicode:true})),unicode);
  await check('unicode-bom',archive(file(0x7a,'CMT',Buffer.from('\ufeff'+unicode+'\0','utf16le'),{unicode:true})),unicode);
  await check('ansi',archive(file(0x7a,'CMT',Buffer.from('RAR4 ANSI\r\nsecond line'))),'RAR4 ANSI\r\nsecond line');
  await check('old',archive(old(Buffer.from('Legacy OEM comment\r\nline 2')),true),'Legacy OEM comment\r\nline 2');
  await check('empty',archive(file(0x7a,'CMT',Buffer.alloc(0))), '');
  await check('trailing-nul',archive(file(0x7a,'CMT',Buffer.from('Text\0\0'))),'Text');
  // A real RAR3-compressed CMT payload from PHP's maintained RAR extension:
  // https://github.com/php/pecl-file_formats-rar/blob/23da64a92f1552da15c14e7c1d4f84e7945023de/tests/commented.rar
  // Only the 46-byte codec fixture is retained, not third-party implementation code.
  const packed=Buffer.from('09918cbe94a2bfc0b46980a2e4d81ce0cebf8c0d1f0619de3f755688bb1da50c59d98f521f1e585cff67728ac171c2c','hex');
  const compressed=file(0x7a,'CMT',packed,{size:46,crc:0xab2d971c,method:0x33});
  const compressedSource=path.join(root,'compressed.rar');await fs.writeFile(compressedSource,archive(compressed));
  const decoded=(await run({operation:'list',path:compressedSource})).comment;
  assert.equal(Buffer.byteLength(decoded),46);assert.equal(crc(Buffer.from(decoded)),0xab2d971c);
  await check('compressed-real',archive(compressed),decoded);
  await check('old-compressed',archive(old(packed,{size:46,crc:0xab2d971c,method:0x33}),true),decoded);
  await check('sfx-prefix',archive(compressed,false,Buffer.from('MZ'+'.'.repeat(8190))),decoded);
  // A service attached to a file is not the archive's CMT.
  await check('child-comment',archive(Buffer.concat([file(0x7a,'CMT',Buffer.from('ignore'),{flags:0x10}),compressed])),decoded);
  const late=Buffer.concat([signature,stamp(header(0x73,0,13)),file(0x74,'safe.txt',Buffer.from('contents')),compressed,stamp(header(0x7b,0,7))]);
  await check('comment-after-file',late,decoded);
  for(const [name,record] of [
   ['bad-crc',file(0x7a,'CMT',Buffer.from('changed'),{crc:1})],
   ['bad-size',file(0x7a,'CMT',Buffer.from('text'),{size:5})],
   ['large',file(0x7a,'CMT',Buffer.from('text'),{size:262145})],
   ['large-packed',file(0x7a,'CMT',Buffer.alloc(262145),{size:1})],
   ['bad-codec',file(0x7a,'CMT',packed,{size:46,crc:0xab2d971c,method:0x36})],
   ['bad-stream',file(0x7a,'CMT',Buffer.from('broken compressed stream'),{size:46,crc:0xab2d971c,method:0x33})],
   ['bad-unicode',file(0x7a,'CMT',Buffer.from([0,0xd8]),{unicode:true})],
   ['odd-unicode',file(0x7a,'CMT',Buffer.from([0x61]),{unicode:true})],
   ['embedded-nul',file(0x7a,'CMT',Buffer.from('a\0b'))]
  ]){
   const source=path.join(root,name+'.rar'),bytes=archive(record);await fs.writeFile(source,bytes);
   for(const operation of ['list','test'])await assert.rejects(run({operation,path:source}),/备注|RAR|archive/i);
   assert.deepEqual(await fs.readFile(source),bytes);
  }
  const boundary=path.join(root,'boundary.rar');await fs.writeFile(boundary,archive(file(0x7a,'CMT',Buffer.alloc(262144,1))));
  assert.equal((await run({operation:'list',path:boundary})).comment.length,262144);
  assert.equal((await run({operation:'test',path:boundary})).count,1);
  const legacyBad=path.join(root,'bad-legacy.rar');await fs.writeFile(legacyBad,archive(old(Buffer.from('data'),{crc:1}),true));
  await assert.rejects(run({operation:'test',path:legacyBad}),/备注/);
  for(const [name,bytes] of [
   ['corrupt-comment-header',(()=>{const b=archive(compressed);b[20]^=1;return b;})()],
   ['truncated-comment',archive(compressed).subarray(0,20+compressed.length-1)],
   ['corrupt-inline-header',(()=>{const b=archive(old(Buffer.from('legacy')),true);b[20]^=1;return b;})()]
  ]){
   const source=path.join(root,name+'.rar');await fs.writeFile(source,bytes);
   for(const operation of ['list','test'])await assert.rejects(run({operation,path:source}));
  }
  console.log('RAR4 comments passed: real compressed CMT, legacy inline/store/compression, UTF-16/ANSI, preview/list/search, integrity, malformed/bounded data, extraction and source preservation.');
 }finally{
  await service?.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
