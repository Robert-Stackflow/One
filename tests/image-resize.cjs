const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {build}=require('esbuild');
const sharp=require('sharp');

test('batch resize handles pixels, percent, long edge, orientation and animation',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'image-resize-'));
 try{
  await build({entryPoints:['src/main/image-convert-service.ts','src/main/image-convert-worker.ts','src/shared/image-convert.ts'],outdir:root,outbase:'src',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',external:['sharp']});
  const {ImageConvertService}=require(join(root,'main/image-convert-service.cjs')),{imageResizeDimensions,imageResizeRule}=require(join(root,'shared/image-convert.cjs'));
  const service=new ImageConvertService(),landscape=join(root,'landscape.png'),portrait=join(root,'portrait.png'),oriented=join(root,'oriented.jpg'),gif=join(root,'animation.gif'),out=join(root,'out');await mkdir(out);
  await sharp({create:{width:120,height:80,channels:3,background:'red'}}).png().toFile(landscape);
  await sharp({create:{width:80,height:120,channels:3,background:'blue'}}).png().toFile(portrait);
  await sharp({create:{width:120,height:80,channels:3,background:'yellow'}}).jpeg().withMetadata({orientation:6}).toFile(oriented);
  const red=await sharp({create:{width:16,height:16,channels:4,background:'red'}}).gif().toBuffer(),blue=await sharp({create:{width:16,height:16,channels:4,background:'blue'}}).gif().toBuffer(),start=blue.indexOf(44),descriptor=Buffer.from(blue.subarray(start,start+10));descriptor[9]=0x80;
  await writeFile(gif,Buffer.concat([red.subarray(0,red.length-1),blue.subarray(start-8,start),descriptor,blue.subarray(13,19),blue.subarray(start+10,blue.length-1),Buffer.from([59])]));
  assert.deepEqual(imageResizeDimensions({mode:'pixels',width:60,height:60,keepAspect:true},120,80),{width:60,height:40});
  assert.deepEqual(imageResizeDimensions({mode:'pixels',width:60,height:60,keepAspect:false},120,80),{width:60,height:60});
  assert.deepEqual(imageResizeDimensions({mode:'long-edge',longEdge:240,keepAspect:true},80,120),{width:160,height:240});
  assert.throws(()=>imageResizeRule({mode:'pixels',width:60,keepAspect:false}),/必须同时/);
  assert.throws(()=>imageResizeRule({mode:'percent',percent:500,keepAspect:true}),/400/);
  const run=(paths,resize)=>service.start(1,paths,out,{format:'original',quality:95,preserveMetadata:false,resize},()=>{});
  const percent=await run([landscape,portrait],{mode:'percent',percent:50,keepAspect:true});assert.deepEqual(percent.results.map(result=>[result.status,result.width,result.height]),[['done',60,40],['done',40,60]],JSON.stringify(percent.results));assert.match(percent.results[0].output,/-resized-.*\.png$/);
  const pixels=await run([landscape],{mode:'pixels',width:60,height:60,keepAspect:false});assert.equal(pixels.results[0].width,60);assert.equal(pixels.results[0].height,60);
  const longEdge=await run([landscape,portrait,oriented],{mode:'long-edge',longEdge:240,keepAspect:true});assert.deepEqual(longEdge.results.map(result=>[result.status,result.width,result.height]),[['done',240,160],['done',160,240],['done',160,240]],JSON.stringify(longEdge.results));
  const animated=await run([gif],{mode:'percent',percent:50,keepAspect:true});assert.equal(animated.results[0].status,'done',JSON.stringify(animated.results[0]));assert.equal(animated.results[0].pages,2);assert.equal(animated.results[0].width,8);assert.equal(animated.results[0].height,8);
  assert.equal((await sharp(landscape).metadata()).width,120);
 }finally{await rm(root,{recursive:true,force:true});}
});
