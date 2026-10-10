const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readdir,rm,writeFile,stat}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {randomBytes}=require('node:crypto');
const {build}=require('esbuild');
const sharp=require('sharp');

test('local image batch conversion preserves source, animation and cancellation cleanup',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'one-image-convert-'));
 try{
  await build({entryPoints:['src/main/image-convert-service.ts','src/main/image-convert-worker.ts'],outdir:root,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',external:['sharp']});
  const {ImageConvertService}=require(join(root,'image-convert-service.cjs'));
  const service=new ImageConvertService(),source=join(root,'source.png'),jpeg=join(root,'photo.jpg'),gif=join(root,'animation.gif'),tiff=join(root,'photo.tiff'),out=join(root,'out');
  const {mkdir}=require('node:fs/promises');await mkdir(out);
  await sharp({create:{width:8,height:8,channels:4,background:{r:240,g:20,b:20,alpha:0.3}}}).png().toFile(source);
  const frame=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).gif().toBuffer();
  const blue=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).gif().toBuffer(),start=blue.indexOf(44),descriptor=Buffer.from(blue.subarray(start,start+10));
  descriptor[9]=0x80; // Give the second frame its own two-color palette.
  await writeFile(gif,Buffer.concat([frame.subarray(0,frame.length-1),blue.subarray(start-8,start),descriptor,blue.subarray(13,19),blue.subarray(start+10,blue.length-1),Buffer.from([59])]));
  await sharp(source).tiff().toFile(tiff);
  await sharp(randomBytes(512*512*3),{raw:{width:512,height:512,channels:3}}).jpeg({quality:95}).toFile(jpeg);
  const settings={format:'jpeg',quality:82,maxWidth:4,maxHeight:4,preserveMetadata:false};
  const updates=[];const first=await service.start(1,[source],out,settings,value=>updates.push(value));
  assert.equal(first.results[0].status,'done');assert.equal(first.results[0].before,(await stat(source)).size);
  assert.equal((await sharp(first.results[0].output).metadata()).width,4);
  assert.match(first.results[0].message,/白色/);assert.ok(updates.some(value=>value.done===1));
  assert.equal((await sharp(source).metadata()).format,'png');
  const animated=await service.start(1,[gif,tiff],out,{format:'webp',quality:75,preserveMetadata:true},()=>{});
  assert.deepEqual(animated.results.map(result=>result.status),['done','done'],JSON.stringify(animated.results));
  assert.equal((await sharp(animated.results[0].output,{animated:true}).metadata()).pages,2);
  for(const format of ['gif','tiff']){
   const converted=await service.start(1,[gif],out,{format,quality:75,preserveMetadata:true},()=>{});
   assert.equal(converted.results[0].status,'done',JSON.stringify(converted.results[0]));
   assert.equal((await sharp(converted.results[0].output,{animated:true}).metadata()).pages,2);
  }
  const compressed=await service.start(1,[source,gif],out,{format:'original',quality:70,preserveMetadata:false},()=>{});
  assert.deepEqual(compressed.results.map(result=>result.status),['done','done'],JSON.stringify(compressed.results));
  assert.match(compressed.results[0].output,/compressed-.*\.png$/);
  assert.equal((await sharp(compressed.results[1].output,{animated:true}).metadata()).pages,2);
  const jpegCompressed=await service.start(1,[jpeg],out,{format:'original',quality:20,preserveMetadata:false},()=>{});
  assert.equal(jpegCompressed.results[0].status,'done',JSON.stringify(jpegCompressed.results[0]));
  assert.ok(jpegCompressed.results[0].after<jpegCompressed.results[0].before);
  const rejected=await service.start(1,[gif],out,{format:'png',quality:80,preserveMetadata:false},()=>{});
  assert.equal(rejected.results[0].status,'error');assert.match(rejected.results[0].message,/动画|多页/);
  const pending=service.start(1,Array(40).fill(0).map((_,index)=>{const duplicate=join(root,`copy-${index}.png`);return duplicate;}),out,settings,()=>{});
  // Missing files are still queued, so terminating immediately must mark unstarted items cancelled.
  for(let attempt=0;attempt<40&&!service.pendingTasks;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(service.cancel(1),true);const cancelled=await pending;assert.equal(cancelled.cancelled,true);
  assert.equal((await readdir(out)).filter(name=>name.startsWith('.one-image-')).length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
