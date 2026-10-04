const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('esbuild');

test('preview image dimensions are read from headers without decoding full images',async()=>{
  const output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/preview-image-dimensions');
  await fs.mkdir(output,{recursive:true});
  const outfile=path.join(output,'preview-resource.cjs');
  await build({entryPoints:['src/main/preview-resource.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
  const {previewImageDimensions}=require(outfile);
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(4018,16);png.writeUInt32BE(1185,20);
  const gif=Buffer.alloc(10);gif.write('GIF89a');gif.writeUInt16LE(640,6);gif.writeUInt16LE(480,8);
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0,17,8,0x02,0xd0,0x05,0,3,1,0x11,0,2,0x11,0,3,0x11,0]);
  const webp=Buffer.alloc(30);webp.write('RIFF',0);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(1919,24,3);webp.writeUIntLE(1079,27,3);
  for(const [name,bytes,expected] of [['image.png',png,{width:4018,height:1185}],['image.gif',gif,{width:640,height:480}],['image.jpg',jpeg,{width:1280,height:720}],['image.webp',webp,{width:1920,height:1080}],['image.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"></svg>'),{width:800,height:450}],['invalid.png',Buffer.from('not an image'),null]]){
    const file=path.join(output,name);await fs.writeFile(file,bytes);assert.deepEqual(await previewImageDimensions(file),expected,name);
  }
});
