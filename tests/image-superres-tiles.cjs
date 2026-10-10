const assert=require('node:assert/strict');
const {upscaleRgbTiles}=require('../dist/main/image-superres-tiles.cjs');

const width=267,height=139,source=Buffer.alloc(width*height*3);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const index=(y*width+x)*3;source[index]=x%256;source[index+1]=y%256;source[index+2]=(x*7+y*11)%256;
}
const nearest=async(input,w,h)=>{
 const output=new Float32Array(w*h*16*3),pixels=w*h,scaled=w*h*16;
 for(let y=0;y<h*4;y++)for(let x=0;x<w*4;x++)for(let channel=0;channel<3;channel++)
  output[channel*scaled+y*w*4+x]=input[channel*pixels+Math.floor(y/4)*w+Math.floor(x/4)];
 return output;
};
(async()=>{
 const progress=[],result=await upscaleRgbTiles(source,width,height,nearest,value=>progress.push(value));
 assert.equal(result.length,width*height*48);assert.deepEqual(progress.at(-1),{done:6,total:6});
 for(let y=0;y<height*4;y++)for(let x=0;x<width*4;x++){
  const expected=(Math.floor(y/4)*width+Math.floor(x/4))*3,actual=(y*width*4+x)*3;
  for(let channel=0;channel<3;channel++)assert.equal(result[actual+channel],source[expected+channel],'pixel '+x+','+y+','+channel);
 }
 await assert.rejects(upscaleRgbTiles(source,width,height,async()=>new Float32Array(3)),/输出尺寸/);
 await assert.rejects(upscaleRgbTiles(source,2049,height,nearest),/输入尺寸/);
 let calls=0;await assert.rejects(upscaleRgbTiles(source,width,height,async(...args)=>{calls++;return nearest(...args);},()=>{throw Error('cancelled');}),/cancelled/);assert.equal(calls,1);
 console.log('image-superres-tiles: non-divisible dimensions, overlap, stitching and bounds passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
