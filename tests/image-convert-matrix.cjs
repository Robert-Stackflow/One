const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {resolve,join}=require('node:path');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const sharp=require('sharp');
const {png16}=require('./fixtures/png16.cjs');

test('conversion preserves supported bit depth, alpha, TIFF pages and animation timing',async()=>{
 const root=await mkdtemp(resolve('work/current/image-matrix-')),out=join(root,'out');
 try{
  await mkdir(out);
  await build({entryPoints:['src/main/image-convert-service.ts','src/main/image-convert-worker.ts'],outdir:root,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',external:['sharp','svgo']});
  const {ImageConvertService}=require(join(root,'image-convert-service.cjs')),service=new ImageConvertService();
  const run=async(source,format,compressionMode='quality',extra={})=>(await service.start(1,[source],out,{format,quality:85,compressionMode,preserveMetadata:false,metadataPolicy:'none',...extra},()=>{})).results[0];
  for(const channels of [1,3,4]){
   const source=join(root,`depth16-${channels}.png`);await writeFile(source,png16(channels));
   const input=await sharp(source).metadata();assert.equal(input.depth,'ushort');
   const result=await run(source,'png','lossless');assert.equal(result.status,'done',result.message);
   const output=await sharp(result.output).metadata();assert.equal(output.depth,'ushort');assert.equal(output.channels,input.channels);
   assert((await sharp(source).raw({depth:'ushort'}).toBuffer()).equals(await sharp(result.output).raw({depth:'ushort'}).toBuffer()));
   if(channels===4){const retained=await run(source,'png','lossless',{preserveMetadata:true,metadataPolicy:'all'});assert.equal(retained.status,'done',retained.message);assert.equal((await sharp(retained.output).metadata()).depth,'ushort');}
   if(channels===3){
    for(const format of ['webp','tiff']){const rejected=await run(source,format,'lossless');assert.equal(rejected.status,'error');assert.match(rejected.message,/位深/);}
    const quality=await run(source,'png');assert.equal(quality.status,'done',quality.message);assert.equal((await sharp(quality.output).metadata()).depth,'uchar');assert.match(quality.message,/8 位/);
   }
  }
  const alpha=join(root,'alpha.png'),pixels=Buffer.from([255,0,0,0,0,255,0,128,0,0,255,255,24,40,80,76]);
  await sharp(pixels,{raw:{width:2,height:2,channels:4}}).png().toFile(alpha);
  for(const format of ['png','webp']){const result=await run(alpha,format,'lossless');assert.equal(result.status,'done',result.message);const original=await sharp(alpha).ensureAlpha().raw().toBuffer(),converted=await sharp(result.output).ensureAlpha().raw().toBuffer();assert(original.equals(converted),`${format}: ${[...original]} -> ${[...converted]}`);}
  const turned=join(root,'orientation.tiff'),colors=Buffer.from([255,0,0,0,255,0,0,0,255,0,255,255,255,0,255,255,255,0]);
  await sharp(colors,{raw:{width:3,height:2,channels:3}}).tiff({compression:'lzw'}).toFile(turned);
  const tagged=spawnSync(require('exiftool-vendored.exe'),['-overwrite_original','-Orientation#=6',turned],{encoding:'utf8'});assert.equal(tagged.status,0,tagged.stderr||tagged.stdout);
  assert.equal((await sharp(turned).metadata()).orientation,6);
  const rotated=await run(turned,'png');assert.equal(rotated.status,'done',rotated.message);
  const rotatedInfo=await sharp(rotated.output).metadata();assert.equal(rotatedInfo.width,2);assert.equal(rotatedInfo.height,3);
  assert((await sharp(rotated.output).raw().toBuffer()).equals(Buffer.from([0,255,255,255,0,0,255,0,255,0,255,0,255,255,0,0,0,255])));
  const animation=join(root,'finite.gif');await sharp('tests/fixtures/image-preview/loop.gif',{animated:true}).gif({loop:2,delay:[140,220,300]}).toFile(animation);
  for(const format of ['gif','webp']){const result=await run(animation,format);assert.equal(result.status,'done',result.message);const output=await sharp(result.output,{animated:true}).metadata();assert.equal(output.pages,3);assert.equal(output.loop,2);assert.deepEqual(output.delay,[140,220,300]);}
  const tiff=join(root,'pages.tiff');await sharp(animation,{animated:true}).tiff({compression:'lzw'}).toFile(tiff);
  const result=await run(tiff,'tiff','lossless');assert.equal(result.status,'done',result.message);assert.equal((await sharp(result.output,{animated:true}).metadata()).pages,3);
  for(let page=0;page<3;page++)assert((await sharp(tiff,{page}).raw().toBuffer()).equals(await sharp(result.output,{page}).raw().toBuffer()),`TIFF page ${page}`);
 }finally{await rm(root,{recursive:true,force:true});}
});
