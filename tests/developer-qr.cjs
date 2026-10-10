const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdirSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {buildSync}=require('esbuild');
const sharp=require('sharp');

test('QR generator produces bounded PNG for UTF-8 text and validates options',async()=>{
 const root=resolve('work/current/developer-qr-unit');mkdirSync(root,{recursive:true});
 try{
  const output=join(root,'qr.cjs');buildSync({entryPoints:['src/main/developer-qr.ts'],outfile:output,bundle:true,platform:'node',target:'node22'});
  const {generateQr}=require(output),png=await generateQr({text:'One 二维码 https://example.com',size:512,level:'M'});
  assert(png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));const info=await sharp(png).metadata();assert.equal(info.width,512);assert.equal(info.height,512);
  await assert.rejects(generateQr({text:'',size:512,level:'M'}),/内容/);await assert.rejects(generateQr({text:'x',size:10000,level:'M'}),/尺寸/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
