// Offline parity against One's native ONNX Runtime. No application model registration.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),ort=require('onnxruntime-node');
async function main(){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
 const root=path.resolve(options.root||''),report=path.resolve(options.report||''),backend=options.backend||'cpu',deviceId=Number(options.device||0);
 assert.ok(options.root&&options.report&&['cpu','dml'].includes(backend));assert.ok(Number.isInteger(deviceId)&&deviceId>=0&&deviceId<=31);
 const digest=data=>createHash('sha256').update(data).digest('hex'),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')),sessions={},checks=[],profilePrefix='pix2tex-'+backend+'-'+deviceId+'-'+randomUUID(),providers={};
 async function tensor(descriptor){const buffer=await fs.readFile(path.join(root,descriptor.file));assert.equal(digest(buffer),descriptor.sha256);return new ort.Tensor('float32',new Float32Array(buffer.buffer,buffer.byteOffset,buffer.length/4),descriptor.shape);}
 async function compare(actual,expected,label){
  const reference=await tensor(expected);assert.deepEqual(actual.dims,reference.dims,label);let maxAbs=0,maxRelative=0,top1=0,referenceTop1=0;
  for(let i=0;i<actual.data.length;i++){const a=Number(actual.data[i]),b=Number(reference.data[i]);assert.ok(Number.isFinite(a)&&Number.isFinite(b));const difference=Math.abs(a-b);maxAbs=Math.max(maxAbs,difference);maxRelative=Math.max(maxRelative,difference/Math.max(1,Math.abs(b)));assert.ok(difference<=.001+.0001*Math.abs(b),`${label}: ${i}, ${a} != ${b}`);if(a>actual.data[top1])top1=i;if(b>reference.data[referenceTop1])referenceTop1=i;}
  if(!label.endsWith('encoder'))assert.equal(top1,referenceTop1,label+' argmax');checks.push({label,shape:actual.dims,maxAbs,maxRelative,top1});
 }
 try{
  for(const name of ['encoder','decoder','resizer']){
   const artifact=manifest.artifacts.find(item=>item.name===name+'.onnx'),file=path.join(root,artifact.name),data=await fs.readFile(file);assert.equal(data.length,artifact.bytes);assert.equal(digest(data),artifact.sha256);
   sessions[name]=await ort.InferenceSession.create(file,{executionProviders:backend==='cpu'?['cpu']:[{name:'dml',deviceId}],graphOptimizationLevel:'all',enableMemPattern:backend==='cpu',executionMode:'sequential',intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3,enableProfiling:true,profileFilePrefix:path.join(root,profilePrefix+'-'+name)});
  }
  for(const sample of manifest.cases){
   const start=Date.now(),encoded=(await sessions.encoder.run({image:await tensor(sample.image)})).encoded;await compare(encoded,sample.encoded,sample.id+' encoder');
   for(const resize of sample.resizer)await compare((await sessions.resizer.run({image:await tensor(resize.image)})).logits,resize.logits,sample.id+' resizer');
   for(const step of sample.steps){const ids=new ort.Tensor('int64',BigInt64Array.from(step.ids[0].map(BigInt)),[1,step.ids[0].length]);await compare((await sessions.decoder.run({ids,context:encoded})).logits,step.logits,sample.id+' decoder '+step.ids[0].length);}
   console.log(JSON.stringify({passed:sample.id,backend,deviceId,milliseconds:Date.now()-start}));
  }
  for(const [name,session] of Object.entries(sessions)){session.endProfiling();await session.release();delete sessions[name];providers[name]={};for(const file of (await fs.readdir(root)).filter(file=>file.startsWith(profilePrefix+'-'+name)&&file.endsWith('.json'))){const events=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));for(const event of events)if(event.cat==='Node'&&event.args?.provider)providers[name][event.args.provider]=(providers[name][event.args.provider]||0)+1;}assert.ok(Object.keys(providers[name]).length);if(backend==='dml')assert.ok(providers[name].DmlExecutionProvider>0,name+' must execute actual GPU kernels');}
  await fs.writeFile(report,JSON.stringify({passed:true,backend,deviceId,runtime:ort.env.versions,model:manifest.model,runnerSha256:digest(await fs.readFile(__filename)),manifestSha256:digest(await fs.readFile(path.join(root,'manifest.json'))),cases:manifest.cases.length,checks,providers,scope:'Native graph parity only; does not establish formula recognition quality.'},null,2));
 }finally{await Promise.all(Object.values(sessions).map(session=>session.release()));}
}
main().catch(error=>{console.error(String(error).slice(0,1600));process.exitCode=1;});
