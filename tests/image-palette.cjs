const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {resolve}=require('node:path');

test('image palette extracts weighted visible colors and bounds work',()=>{
 const outfile=resolve('work/current/image-palette.cjs');buildSync({entryPoints:['src/shared/image-palette.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 const {extractImagePalette}=require(outfile),pixels=new Uint8ClampedArray(100*4);
 for(let index=0;index<100;index++)pixels.set(index<75?[255,0,0,255]:[0,0,255,255],index*4);
 const colors=extractImagePalette(pixels,100,1);assert.deepEqual(colors,[{hex:'#FF0000',percent:75},{hex:'#0000FF',percent:25}]);
 assert.deepEqual(extractImagePalette(Uint8ClampedArray.from([255,0,0,255,0,0,255,0]),2,1),[{hex:'#FF0000',percent:100}]);
 assert.deepEqual(extractImagePalette(Uint8ClampedArray.from([0,255,0,128]),1,1),[{hex:'#7FFF7F',percent:100}]);
 const gradient=new Uint8ClampedArray(256*4);for(let index=0;index<256;index++)gradient.set([index,index,index,255],index*4);
 const shades=extractImagePalette(gradient,256,1);assert.equal(shades.length,8);assert.ok(Math.abs(shades.reduce((sum,color)=>sum+color.percent,0)-100)<1);
 assert.throws(()=>extractImagePalette(gradient,257,1),/样本无效/);
});
