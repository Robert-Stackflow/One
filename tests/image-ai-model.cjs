const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createServer}=require('node:http');
const {mkdtemp,readFile,writeFile,rm,stat}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {ensureAiModel,validAiModel,aiModelPath}=require('../dist/main/image-ai-model.cjs');

(async()=>{
 const folder=await mkdtemp(join(tmpdir(),'one-image-ai-'));
 const content=Buffer.from('One local model cache test\n'.repeat(256));
 let served=content,stallNext=false;
 const server=createServer((request,response)=>{response.writeHead(200,{'content-length':served.length});if(stallNext){stallNext=false;response.write(served.subarray(0,32));}else response.end(served);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const model={id:'test-model',url:`http://127.0.0.1:${server.address().port}/model.onnx`,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};
 try{
  let received=0;const path=await ensureAiModel(folder,new AbortController().signal,value=>{received=value;},model);
  assert.equal(received,content.length);assert.equal(path,aiModelPath(folder,model));assert.deepEqual(await readFile(path),content);assert.equal(await validAiModel(folder,model),true);
  const stale=join(folder,'models','test-model-000000000000.onnx');await writeFile(stale,'stale');await ensureAiModel(folder,new AbortController().signal,()=>{},model);assert.equal(await stat(stale).catch(()=>null),null);
  await new Promise(resolve=>server.close(resolve));
  assert.equal(await ensureAiModel(folder,new AbortController().signal,()=>{},model),path,'cached model works offline');
  await rm(path);served=Buffer.alloc(content.length,0);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));model.url=`http://127.0.0.1:${server.address().port}/model.onnx`;
  await assert.rejects(ensureAiModel(folder,new AbortController().signal,()=>{},model),/校验失败/);assert.equal(await stat(path).catch(()=>null),null);
  const controller=new AbortController();await assert.rejects(ensureAiModel(folder,controller.signal,()=>controller.abort(),model));assert.equal(await stat(path).catch(()=>null),null);
  served=content;stallNext=true;await ensureAiModel(folder,new AbortController().signal,()=>{},model,80);assert.deepEqual(await readFile(path),content);
  console.log('image-ai-model: download, checksum, offline cache, cancellation and stalled-transfer retry passed');
 }finally{server.close();await rm(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
