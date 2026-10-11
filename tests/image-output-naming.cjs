const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {resolve}=require('node:path');

test('image output names keep sequence and a collision reducing suffix',()=>{
 const outfile=resolve('work/current/image-output-naming.cjs');buildSync({entryPoints:['src/shared/image-convert.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 const {imageOutputNaming,imageOutputStem}=require(outfile),id='a1b2c3d4';
 assert.deepEqual(imageOutputNaming(undefined),{mode:'default'});
 assert.equal(imageOutputStem('photo',1,'converted',id,{mode:'default'}),'photo-converted-a1b2c3d4');
 assert.equal(imageOutputStem('photo',2,'converted',id,{mode:'numbered'}),'photo-002-a1b2c3d4');
 assert.equal(imageOutputStem('photo',100,'converted',id,imageOutputNaming({mode:'prefix',prefix:' 假期 照片 '})),'假期 照片-100-a1b2c3d4');
 for(const prefix of ['','../private','a/b','x'.repeat(41)])assert.throws(()=>imageOutputNaming({mode:'prefix',prefix}),/前缀/);
});
