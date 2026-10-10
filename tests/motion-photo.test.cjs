const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild');
const {fixtures,box,appleMaker,identifiedMovie,id}=require('./image-preview-fixtures.cjs');
const JSZip=require('jszip');
const output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/current/image-preview/unit');
const ready=(async()=>{await fs.mkdir(output,{recursive:true});const target=path.join(output,'motion-photo.cjs');await build({entryPoints:['src/main/motion-photo.ts'],outfile:target,bundle:true,platform:'node'});return require(target);})();
test('stored LIVP exposes validated photo and movie slices without extracting files',async()=>{
 const {inspectLivp,releaseLivpTemporary}=await ready,dir=path.join(output,'livp');await fs.mkdir(dir,{recursive:true});
 const {photo:photoBytes,movie}=await fixtures(dir);
 const make=async(name,add)=>{const zip=new JSZip();zip.file('IMG_1.JPG.jpeg',photoBytes,{compression:'STORE'});if(add)add(zip);const file=path.join(dir,name);await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer',compression:'STORE'}));return file;};
 const file=await make('pair.livp',zip=>zip.file('IMG_1.JPG.mov',movie,{compression:'STORE'}));
 const before=await fs.readFile(file),found=await inspectLivp(file);
 assert.equal(found.still.mime,'image/jpeg');assert.deepEqual(before.subarray(found.still.offset,found.still.offset+found.still.length),photoBytes);
 assert.equal(found.movie.source,'LIVP 导出包');assert.deepEqual(before.subarray(found.movie.offset,found.movie.offset+found.movie.length),movie);
 assert.deepEqual(await fs.readFile(file),before);
 assert.equal((await inspectLivp(await make('still.livp'))).movie,null);
 const ambiguous=await make('ambiguous.livp',zip=>{zip.file('first.mov',movie);zip.file('second.mov',movie);});
 await assert.rejects(()=>inspectLivp(ambiguous),/不明确/);
 const compressed=new JSZip();compressed.file('image.jpeg',photoBytes,{compression:'DEFLATE'});compressed.file('image.mp4',movie,{compression:'DEFLATE'});const compressedFile=path.join(dir,'compressed.livp');await fs.writeFile(compressedFile,await compressed.generateAsync({type:'nodebuffer'}));
 const extracted=await inspectLivp(compressedFile);assert.ok(extracted.temporary);assert.deepEqual(await fs.readFile(extracted.still.path),photoBytes);assert.deepEqual(await fs.readFile(extracted.movie.path),movie);
 await releaseLivpTemporary(extracted.temporary);await assert.rejects(()=>fs.stat(extracted.temporary.directory),/ENOENT/);
});
test('embedded motion photo variants expose only their valid movie slice',async t=>{
 const {inspectMotionPhoto}=await ready,{movie}=await fixtures(path.join(output,'embedded'));
 for(const [name,source] of [['google-old.jpg','Google MicroVideo'],['google-container.jpg','Motion Photo'],['samsung-sef.jpg','Samsung SEF'],['samsung-mpv2.jpg','Samsung SEF'],['vendor-trailer.jpg','嵌入式动态照片'],['heic-motion.heic','Motion Photo mpvd']])await t.test(name,async()=>{
  const file=path.join(output,'embedded',name),before=await fs.readFile(file),found=await inspectMotionPhoto(file);assert.equal(found.source,source);assert.equal(found.length,movie.length);assert.deepEqual(before.subarray(found.offset,found.offset+found.length),movie);assert.deepEqual(await fs.readFile(file),before);if(name==='google-old.jpg')assert.equal(found.presentationTime,.5);
 });
});
test('sidecars prefer matching Apple content identifiers and reject mismatched identifiers',async()=>{
 const {inspectMotionPhoto}=await ready,dir=path.join(output,'apple');await fs.mkdir(dir,{recursive:true});
 const photo=path.join(dir,'photo.jpg');await fs.writeFile(photo,Buffer.concat([Buffer.from([255,216]),appleMaker(),Buffer.from([255,217])]));
 await fs.writeFile(path.join(dir,'photo.MOV'),identifiedMovie('aaaaaaaa-1234-1234-1234-123456789abc'));
 await fs.writeFile(path.join(dir,'renamed.MOV'),identifiedMovie());
 const found=await inspectMotionPhoto(photo);assert.equal(found.path,path.join(dir,'renamed.MOV'));assert.equal(found.source,'Apple Live Photo（标识匹配）');assert.equal(found.paired,true);
 await fs.unlink(path.join(dir,'renamed.MOV'));let notice='';assert.equal(await inspectMotionPhoto(photo,message=>notice=message),null);assert.match(notice,/未找到匹配/);
 // A metadata-free same-name clip must not hide a renamed, positively identified pair.
 const {movie}=await fixtures(path.join(output,'pair-fallback'));await fs.writeFile(path.join(dir,'photo.MOV'),movie);await fs.writeFile(path.join(dir,'renamed.MOV'),identifiedMovie());
 assert.equal((await inspectMotionPhoto(photo)).path,path.join(dir,'renamed.MOV'));
});
test('same-basename exports work without metadata; static and malformed files stay static',async()=>{
 const {inspectMotionPhoto}=await ready,dir=path.join(output,'bounds'),{photo,movie}=await fixtures(dir);
 assert.equal((await inspectMotionPhoto(path.join(dir,'apple-pair.jpg'))).paired,true);
 assert.equal(await inspectMotionPhoto(path.join(dir,'photo.jpg')),null);
 for(const [name,bytes] of [['fake.jpg',Buffer.concat([photo,box('ftyp',Buffer.from('mp42')),box('mdat',Buffer.alloc(24))])],['truncated.jpg',Buffer.concat([photo,movie.subarray(0,48)])],['invalid-offset.jpg',Buffer.concat([photo,Buffer.from('<x GCamera:MicroVideoOffset="999999999999999999"/>')])],['static.heic',box('ftyp',Buffer.from('heic\0\0\0\0heic'))]]){const file=path.join(dir,name);await fs.writeFile(file,bytes);assert.equal(await inspectMotionPhoto(file),null,name);}
 const oldQuickTime=Buffer.concat([box('wide'),identifiedMovie().subarray(identifiedMovie().readUInt32BE(0))]);await fs.writeFile(path.join(dir,'old-movie.jpg'),Buffer.concat([photo,oldQuickTime]));assert.equal((await inspectMotionPhoto(path.join(dir,'old-movie.jpg'))).length,oldQuickTime.length);
 const huge=path.join(dir,'oversize.jpg');await fs.writeFile(huge,'');await fs.truncate(huge,101*1024*1024);assert.equal(await inspectMotionPhoto(huge),null);await fs.unlink(huge);
});
test('segment responses preserve virtual Range/HEAD semantics and never leak photo or trailer bytes',async()=>{
 const target=path.join(output,'file-response.cjs');await build({entryPoints:['src/main/file-response.ts'],outfile:target,bundle:true,platform:'node'});const {fileResponse}=require(target),file=path.join(output,'range.jpg');await fs.writeFile(file,'PHOTO0123456789TRAILER');
 for(const [range,status,body,contentRange] of [[undefined,200,'0123456789',null],['bytes=2-5',206,'2345','bytes 2-5/10'],['bytes=-3',206,'789','bytes 7-9/10'],['bytes=8-',206,'89','bytes 8-9/10']]){const result=await fileResponse(file,'video/mp4',new Request('https://local/movie',{headers:range?{range}:{}}),{offset:5,length:10});assert.equal(result.status,status);assert.equal(await result.text(),body);assert.equal(result.headers.get('content-range'),contentRange);}
 const head=await fileResponse(file,'video/mp4',new Request('https://local/movie',{method:'HEAD'}),{offset:5,length:10});assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),'10');
 for(const range of ['bytes=10-','bytes=-0','bytes=1-2,4-5','bytes=5-2'])assert.equal((await fileResponse(file,'video/mp4',new Request('https://local/movie',{headers:{range}}),{offset:5,length:10})).status,416);
 assert.equal((await fileResponse(file,'video/mp4',new Request('https://local/movie'),{offset:100,length:2})).status,404);
 assert.equal(await (await fileResponse(file,'image/jpeg',new Request('https://local/image'))).text(),'PHOTO0123456789TRAILER');
});
test('APNG detection skips large ancillary chunks and rejects broken boundaries',async()=>{
 const target=path.join(output,'resource.cjs');await build({entryPoints:['src/main/preview-resource.ts'],outfile:target,bundle:true,platform:'node'});const {isAnimatedPng}=require(target);
 assert.equal(await isAnimatedPng('tests/fixtures/image-preview/loop.apng'),true);assert.equal(await isAnimatedPng('tests/fixtures/image-preview/still.png'),false);
 const signature=Buffer.from([137,80,78,71,13,10,26,10]),chunk=(type,data)=>{const h=Buffer.alloc(8);h.writeUInt32BE(data.length);h.write(type,4);return Buffer.concat([h,data,Buffer.alloc(4)]);},actl=Buffer.alloc(8);actl.writeUInt32BE(3);
 const file=path.join(output,'large-profile.png');await fs.writeFile(file,Buffer.concat([signature,chunk('iCCP',Buffer.alloc(70000)),chunk('acTL',actl)]));assert.equal(await isAnimatedPng(file),true);
 await fs.writeFile(file,Buffer.concat([signature,Buffer.from([255,255,255,255]),Buffer.from('acTL')]));assert.equal(await isAnimatedPng(file),false);
});
