const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {build}=require('esbuild');
const sharp=require('sharp');

test('visual crop rule applies across image sizes and keeps a fixed aspect ratio',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'image-crop-'));
 try{
  await build({entryPoints:['src/main/image-convert-service.ts','src/main/image-convert-worker.ts','src/main/image-crop-preview.ts','src/shared/image-convert.ts'],outdir:root,outbase:'src',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',external:['sharp']});
  const {ImageConvertService}=require(join(root,'main/image-convert-service.cjs')),{imageCropPreview}=require(join(root,'main/image-crop-preview.cjs')),{imageCropBounds,imageCropRule}=require(join(root,'shared/image-convert.cjs'));
  const service=new ImageConvertService(),source=join(root,'square.png'),wide=join(root,'wide.png'),gif=join(root,'animated.gif'),oriented=join(root,'oriented.jpg'),out=join(root,'out');await mkdir(out);
  const raw=Buffer.alloc(100*100*3);for(let y=0;y<100;y++)for(let x=0;x<100;x++){const i=(y*100+x)*3;raw[i]=x<50&&y<50?255:0;raw[i+2]=x<50&&y<50?0:255;}
  await sharp(raw,{raw:{width:100,height:100,channels:3}}).png().toFile(source);
  await sharp({create:{width:200,height:100,channels:3,background:'green'}}).png().toFile(wide);
  await sharp({create:{width:120,height:80,channels:3,background:'yellow'}}).jpeg().withMetadata({orientation:6}).toFile(oriented);
  const frame=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).gif().toBuffer(),start=frame.indexOf(44);
  await writeFile(gif,Buffer.concat([frame.subarray(0,frame.length-1),frame.subarray(start,frame.length-1),Buffer.from([59])]));
  const preview=await imageCropPreview(source);assert.equal(preview.width,100);assert.equal(preview.height,100);assert.match(preview.url,/^data:image\/png;base64,/);
  const orientedPreview=await imageCropPreview(oriented);assert.equal(orientedPreview.width,80);assert.equal(orientedPreview.height,120);
  await assert.rejects(()=>imageCropPreview(gif),/动图|多页/);
  assert.throws(()=>imageCropRule({x:.8,y:0,width:.5,height:.5}),/范围/);
  assert.deepEqual(imageCropBounds({x:0,y:0,width:.5,height:.5},100,100),{left:0,top:0,width:50,height:50});
  const settings={format:'original',quality:95,preserveMetadata:false,crop:{x:0,y:0,width:.5,height:.5}};
  const first=await service.start(1,[source,wide],out,settings,()=>{});assert.deepEqual(first.results.map(result=>result.status),['done','done'],JSON.stringify(first.results));
  assert.match(first.results[0].output,/-cropped-.*\.png$/);
  assert.equal((await sharp(first.results[0].output).metadata()).width,50);assert.equal((await sharp(first.results[1].output).metadata()).width,100);
  const pixel=await sharp(first.results[0].output).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.deepEqual([...pixel.subarray(0,3)],[255,0,0]);
  const fixed=await service.start(1,[source,wide],out,{...settings,crop:{x:.1,y:.1,width:.8,height:.8,ratio:1}},()=>{});
  assert.deepEqual(fixed.results.map(result=>result.status),['done','done'],JSON.stringify(fixed.results));
  for(const result of fixed.results){const metadata=await sharp(result.output).metadata();assert.equal(metadata.width,metadata.height);}
  const rotated=await service.start(1,[oriented],out,{...settings,crop:{x:0,y:0,width:.5,height:.5}},()=>{});
  assert.equal(rotated.results[0].status,'done',JSON.stringify(rotated.results[0]));const rotatedMetadata=await sharp(rotated.results[0].output).metadata();assert.equal(rotatedMetadata.orientation,undefined);assert.equal(rotatedMetadata.width,40);assert.equal(rotatedMetadata.height,60);
  const animated=await service.start(1,[gif],out,settings,()=>{});assert.equal(animated.results[0].status,'error');assert.match(animated.results[0].message,/动图|多页/);
 }finally{await rm(root,{recursive:true,force:true});}
});
