const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,readdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {build}=require('esbuild');
const {fixtures}=require('./image-preview-fixtures.cjs');

test('export copies the exact embedded or paired video and protects originals',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'one-motion-export-'));
 try{
  const {movie}=await fixtures(directory),bundle=resolve('work/current/motion-photo-export-unit.cjs');
  await build({entryPoints:['src/main/motion-photo-export.ts'],outfile:bundle,bundle:true,platform:'node'});
  const inspectBundle=resolve('work/current/motion-photo-inspect-unit.cjs');
  await build({entryPoints:['src/main/motion-photo.ts'],outfile:inspectBundle,bundle:true,platform:'node'});
  const {exportMotionPhotoVideo}=require(bundle),{inspectMotionPhoto}=require(inspectBundle);
  for(const name of ['google-old.jpg','oppo-video-length.jpg','apple-pair.jpg']){
   const original=await readFile(join(directory,name));
   const motion=await inspectMotionPhoto(join(directory,name));assert(motion,name);
   const target=join(directory,`${name}-video.${motion.mime==='video/quicktime'?'mov':'mp4'}`);
   assert.equal(await exportMotionPhotoVideo(motion,target,new AbortController().signal),movie.length);
   assert.deepEqual(await readFile(target),movie);
   assert.deepEqual(await readFile(join(directory,name)),original);
  }
  const paired=await inspectMotionPhoto(join(directory,'apple-pair.jpg'));
  await assert.rejects(exportMotionPhotoVideo(paired,join(directory,'apple-pair.MOV'),new AbortController().signal),/不能覆盖原始/);
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(exportMotionPhotoVideo(paired,join(directory,'cancelled.mov'),cancelled.signal));
  assert.equal((await readdir(directory)).some(name=>name.startsWith('.one-motion-')),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
