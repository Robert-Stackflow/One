const assert=require('node:assert/strict');
const {mkdtemp,mkdir,copyFile,readdir,rm}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const sharp=require('sharp');
const {ImageAiService}=require('../dist/main/image-ai-service.cjs');

(async()=>{
 const model=process.env.ONE_SUPERRES_MODEL;if(!model)throw Error('Set ONE_SUPERRES_MODEL to the verified ONNX model path');
 const folder=await mkdtemp(join(tmpdir(),'one-superres-cancel-')),profile=join(folder,'profile'),output=join(folder,'output'),source=join(folder,'source.png');
 await mkdir(join(profile,'models'),{recursive:true});await mkdir(output);
 await copyFile(model,join(profile,'models','realesr-general-x4v3-4ca39b3a965e.onnx'));
 await sharp({create:{width:512,height:512,channels:3,background:'#5588bb'}}).png().toFile(source);
 try{
  const service=new ImageAiService(profile);let cancelled=false,done=0;
  await assert.rejects(service.startSuperResolution(1,source,output,progress=>{if(progress.done)done=progress.done;if(done>=2&&!cancelled){cancelled=true;service.cancel(1);}}),/已取消/);
  assert.equal(cancelled,true);assert.equal((await readdir(output)).length,0);assert.equal(service.pendingTasks,false);
  console.log('image-superres-cancel: stopped after tile '+done+' without output');
 }finally{await rm(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
