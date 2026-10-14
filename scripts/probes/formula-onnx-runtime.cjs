// Offline probe against One's actual native ONNX package, never a UI model registration.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto'),ort=require('onnxruntime-node'),katex=require('katex');
function decode(ids,config){
  const tokenizer=config.PostProcess.character_dict.fast_tokenizer_file;
  assert.equal(tokenizer.decoder.type,'ByteLevel');
  const vocabulary=new Map(Object.entries(tokenizer.model.vocab).map(([text,id])=>[id,text]));
  const special=new Set(tokenizer.added_tokens.filter(token=>token.special).map(token=>token.id));
  const bytes=[];for(let n=33;n<=126;n++)bytes.push(n);for(let n=161;n<=172;n++)bytes.push(n);for(let n=174;n<=255;n++)bytes.push(n);
  const points=[...bytes];for(let n=0,index=0;n<256;n++)if(!bytes.includes(n)){bytes.push(n);points.push(256+index++);}
  const inverse=new Map(points.map((point,index)=>[String.fromCodePoint(point),bytes[index]])),decoded=[];
  for(const value of ids){if(value===2n)break;const id=Number(value);assert.ok(Number.isSafeInteger(id)&&id>=0);if(special.has(id))continue;const text=vocabulary.get(id);assert.notEqual(text,undefined);for(const character of text){const byte=inverse.get(character);assert.notEqual(byte,undefined);decoded.push(byte);}}
  return new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(decoded));
}
async function main(){
  const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
  for(const key of ['model','tensor','config','reference','report']){assert.ok(args[key],key);args[key]=path.resolve(args[key]);}
  const backend=args.backend||'cpu';assert.ok(['cpu','dml'].includes(backend));
  const deviceId=Number(args.device||0);assert.ok(Number.isSafeInteger(deviceId)&&deviceId>=0&&deviceId<=31);
  assert.match(args.sha256||'',/^[a-f0-9]{64}$/);
  const model=await fs.readFile(args.model);assert.equal(createHash('sha256').update(model).digest('hex'),args.sha256);
  const pixels=await fs.readFile(args.tensor);assert.equal(pixels.length,384*384*4);
  const config=JSON.parse(await fs.readFile(args.config,'utf8')),reference=JSON.parse(await fs.readFile(args.reference,'utf8'));
  assert.match(reference.results[0].tokenSha256||'',/^[a-f0-9]{64}$/);
  const directory=path.dirname(args.report);await fs.mkdir(directory,{recursive:true});const prefix=path.basename(args.report,'.json')+'-profile-'+randomUUID();
  const started=performance.now();let session;
  try{
    session=await ort.InferenceSession.create(model,{executionProviders:backend==='dml'?[{name:'dml',deviceId}]:['cpu'],executionMode:'sequential',enableMemPattern:backend!=='dml',intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3,enableProfiling:true,profileFilePrefix:path.join(directory,prefix)});
    assert.equal(session.inputNames.length,1);assert.equal(session.outputNames.length,1);
    const loaded=Math.round(performance.now()-started),tensor=new ort.Tensor('float32',new Float32Array(pixels.buffer,pixels.byteOffset,pixels.length/4),[1,1,384,384]),results=[];
    for(let index=0;index<2;index++){
      const start=performance.now(),values=await session.run({[session.inputNames[0]]:tensor}),output=values[session.outputNames[0]];
      assert.equal(output.type,'int64');assert.ok(output.data.length>0&&output.data.length<=1024);
      const tokenSha256=createHash('sha256').update(Buffer.from(output.data.buffer,output.data.byteOffset,output.data.byteLength)).digest('hex');assert.equal(tokenSha256,reference.results[0].tokenSha256);
      const text=decode(output.data,config);assert.equal(text,reference.results[0].latex);
      katex.renderToString(text,{throwOnError:true,trust:false});
      results.push({iteration:index,inferenceMs:Math.round(performance.now()-start),tokens:output.data.length,tokenSha256,latex:text});
    }
    session.endProfiling();await session.release();session=undefined;
    const providers={};const profiles=(await fs.readdir(directory)).filter(name=>name.startsWith(prefix)&&name.endsWith('.json'));
    for(const name of profiles){const events=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));for(const event of events)if(event.cat==='Node'&&event.args?.provider)providers[event.args.provider]=(providers[event.args.provider]||0)+1;}
    assert.ok(profiles.length,'Native profiling file missing');if(backend==='dml')assert.ok(providers.DmlExecutionProvider>0,'No DirectML kernel actually executed');
    const report={backend,...(backend==='dml'?{deviceId}:{}),ortVersion:require('onnxruntime-node/package.json').version,modelSha256:args.sha256,inputSha256:createHash('sha256').update(pixels).digest('hex'),loadMs:loaded,peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024),providers,results};
    await fs.writeFile(args.report,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:results.map(({latex,...rest})=>rest)}));
  }finally{await session?.release();model.fill(0);pixels.fill(0);}
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
