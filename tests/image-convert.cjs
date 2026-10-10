const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readdir,rm,writeFile,readFile,stat}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {randomBytes}=require('node:crypto');
const {build}=require('esbuild');
const sharp=require('sharp');

test('local image batch conversion preserves source, animation and cancellation cleanup',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'one-image-convert-'));
 try{
  await build({entryPoints:['src/main/image-convert-service.ts','src/main/image-convert-worker.ts'],outdir:root,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',external:['sharp','svgo']});
  const {ImageConvertService}=require(join(root,'image-convert-service.cjs'));
  const service=new ImageConvertService(),source=join(root,'source.png'),jpeg=join(root,'photo.jpg'),gif=join(root,'animation.gif'),tiff=join(root,'photo.tiff'),svg=join(root,'vector.svg'),out=join(root,'out');
  const {mkdir}=require('node:fs/promises');await mkdir(out);
  await sharp({create:{width:8,height:8,channels:4,background:{r:240,g:20,b:20,alpha:0.3}}}).png().toFile(source);
  const frame=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).gif().toBuffer();
  const blue=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).gif().toBuffer(),start=blue.indexOf(44),descriptor=Buffer.from(blue.subarray(start,start+10));
  descriptor[9]=0x80; // Give the second frame its own two-color palette.
  await writeFile(gif,Buffer.concat([frame.subarray(0,frame.length-1),blue.subarray(start-8,start),descriptor,blue.subarray(13,19),blue.subarray(start+10,blue.length-1),Buffer.from([59])]));
  await sharp(source).tiff().toFile(tiff);
  await writeFile(svg,'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><!-- remove me --><rect width="48" height="32" fill="#e35277"/></svg>');
  await sharp(randomBytes(512*512*3),{raw:{width:512,height:512,channels:3}}).jpeg({quality:95}).toFile(jpeg);
  const settings={format:'jpeg',quality:82,maxWidth:4,maxHeight:4,preserveMetadata:false};
  const updates=[];const first=await service.start(1,[source],out,settings,value=>updates.push(value));
  assert.equal(first.results[0].status,'done',JSON.stringify(first.results[0]));assert.equal(first.results[0].before,(await stat(source)).size);
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
  const icons=await service.start(1,[source],out,{format:'ico',quality:80,preserveMetadata:false},()=>{});
  assert.equal(icons.results[0].status,'done',icons.results[0].message);const ico=await readFile(icons.results[0].output);
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  for(const [index,size] of [16,24,32,48,64,128,256].entries()){
   const entry=6+index*16,offset=ico.readUInt32LE(entry+12),length=ico.readUInt32LE(entry+8);assert.equal(ico[entry]||256,size);assert.equal(ico[entry+1]||256,size);
   const png=ico.subarray(offset,offset+length);assert(png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));const info=await sharp(png).metadata();assert.equal(info.width,size);assert.equal(info.height,size);
  }
  const animatedIcon=await service.start(1,[gif],out,{format:'ico',quality:80,preserveMetadata:false},()=>{});assert.equal(animatedIcon.results[0].status,'error');
  const raster=await service.start(1,[svg],out,{format:'png',quality:80,preserveMetadata:false},()=>{});assert.equal(raster.results[0].status,'done',raster.results[0].message);const rasterInfo=await sharp(raster.results[0].output).metadata();assert.equal(rasterInfo.width,48);assert.equal(rasterInfo.height,32);
  const optimizedSvg=await service.start(1,[svg],out,{format:'svg',quality:80,preserveMetadata:false},()=>{});assert.equal(optimizedSvg.results[0].status,'done',optimizedSvg.results[0].message);assert((await readFile(optimizedSvg.results[0].output,'utf8')).includes('<svg'));
  const fakeVector=await service.start(1,[source],out,{format:'svg',quality:80,preserveMetadata:false},()=>{});assert.equal(fakeVector.results[0].status,'error');
  const unsafe=join(root,'unsafe.svg');await writeFile(unsafe,'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>');const rejectedSvg=await service.start(1,[unsafe],out,{format:'png',quality:80,preserveMetadata:false},()=>{});assert.equal(rejectedSvg.results[0].status,'error');
  const motionDir=join(root,'motion');await require('./image-preview-fixtures.cjs').fixtures(motionDir);const motion=join(motionDir,'google-old.jpg');
  const rejectedMotion=await service.start(1,[motion],out,{format:'png',quality:80,preserveMetadata:false},()=>{});assert.equal(rejectedMotion.results[0].status,'error');assert.match(rejectedMotion.results[0].message,/动态照片/);
  const still=await service.start(1,[motion],out,{format:'png',quality:80,preserveMetadata:false,motionPolicy:'still'},()=>{});assert.equal(still.results[0].status,'done',still.results[0].message);assert.match(still.results[0].message,/视频未写入/);
  const rejected=await service.start(1,[gif],out,{format:'png',quality:80,preserveMetadata:false},()=>{});
  assert.equal(rejected.results[0].status,'error');assert.match(rejected.results[0].message,/动画|多页/);
  const pending=service.start(1,Array(40).fill(0).map((_,index)=>{const duplicate=join(root,`copy-${index}.png`);return duplicate;}),out,settings,()=>{});
  // Missing files are still queued, so terminating immediately must mark unstarted items cancelled.
  for(let attempt=0;attempt<40&&!service.pendingTasks;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(service.cancel(1),true);const cancelled=await pending;assert.equal(cancelled.cancelled,true);
  assert.equal((await readdir(out)).filter(name=>name.startsWith('.one-image-')).length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
