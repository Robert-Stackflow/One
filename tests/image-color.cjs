const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {build}=require('esbuild');
const sharp=require('sharp');

test('image color sampling reads original pixels, orientation and first animation frame',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'image-color-'));
 try{
  await build({entryPoints:['src/main/image-color.ts'],outdir:root,bundle:true,platform:'node',target:'node22',format:'cjs',outExtension:{'.js':'.cjs'},external:['sharp']});
  const {imageColorPreview,imageColorSample}=require(join(root,'image-color.cjs')),png=join(root,'pixels.png'),oriented=join(root,'oriented.jpg'),gif=join(root,'animated.gif');
  const pixels=Buffer.from([255,0,0,255,0,0,255,255,255,0,0,0,0,255,0,128]);await sharp(pixels,{raw:{width:2,height:2,channels:4}}).png().toFile(png);
  const preview=await imageColorPreview(png);assert.equal(preview.width,2);assert.equal(preview.height,2);assert.match(preview.url,/^data:image\/png;base64,/);
  const compact=await imageColorPreview(png,true);assert.equal(compact.width,2);assert.equal(compact.height,2);assert.deepEqual(await sharp(Buffer.from(compact.url.split(',')[1],'base64')).metadata().then(value=>[value.width,value.height]),[2,2]);
  const wide=join(root,'wide.png');await sharp({create:{width:600,height:400,channels:3,background:'blue'}}).png().toFile(wide);
  const compactWide=await imageColorPreview(wide,true);assert.deepEqual([compactWide.width,compactWide.height],[600,400]);assert.deepEqual(await sharp(Buffer.from(compactWide.url.split(',')[1],'base64')).metadata().then(value=>[value.width,value.height]),[240,160]);
  assert.equal((await imageColorSample(png,0,0)).hex,'#FF0000');assert.equal((await imageColorSample(png,1,0)).hex,'#0000FF');
  assert.deepEqual(await imageColorSample(png,0,1),{hex:'#FFFFFF',alpha:0,x:0,y:1});
  const blended=await imageColorSample(png,1,1);assert.equal(blended.alpha,50);assert.equal(blended.hex,'#7FFF7F');
  await assert.rejects(()=>imageColorSample(png,2,0),/范围/);
  const orientPixels=Buffer.alloc(40*20*3);for(let y=0;y<20;y++)for(let x=0;x<40;x++){const index=(y*40+x)*3;orientPixels[index]=x<20?255:0;orientPixels[index+2]=x<20?0:255;}
  await sharp(orientPixels,{raw:{width:40,height:20,channels:3}}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).withMetadata({orientation:6}).toFile(oriented);
  const turned=await imageColorPreview(oriented);assert.equal(turned.width,20);assert.equal(turned.height,40);
  const first=await imageColorSample(oriented,10,5),second=await imageColorSample(oriented,10,35);assert.ok(parseInt(first.hex.slice(1,3),16)>200,JSON.stringify({first,second}));assert.ok(parseInt(second.hex.slice(5,7),16)>200);
  const red=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).gif().toBuffer(),blue=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).gif().toBuffer(),start=blue.indexOf(44),descriptor=Buffer.from(blue.subarray(start,start+10));descriptor[9]=0x80;
  await writeFile(gif,Buffer.concat([red.subarray(0,red.length-1),blue.subarray(start-8,start),descriptor,blue.subarray(13,19),blue.subarray(start+10,blue.length-1),Buffer.from([59])]));
  assert.equal((await imageColorPreview(gif)).pages,2);assert.equal((await imageColorSample(gif,0,0)).hex,'#FF0000');
 }finally{await new Promise(resolve=>setTimeout(resolve,100));await rm(root,{recursive:true,force:true});}
});
