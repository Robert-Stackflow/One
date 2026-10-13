import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { LlamaSession, NativeInferenceError } from '../../src/main/recognition/llama-session';
import { deepseekOCRPresets } from '../../src/main/recognition/deepseek-models';

const helper=resolve(process.env.ONE_INFERENCE_MONITOR||'work/current/capture-reconstruction/One.Monitor.Inference.exe');
const spawn=childProcess.spawn;
const root=process.env.ONE_MODEL_TEST_ROOT!;
const fixture=String.raw`
const http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict');
const args=process.argv.slice(1),arg=name=>args[args.indexOf(name)+1],mode=arg('-m').split(/[\\/]/).pop();
const key=fs.readFileSync(arg('--api-key-file'),'utf8');
for(const flag of ['--offline','--no-webui','--no-warmup'])assert.ok(args.includes(flag));
assert.equal(arg('--host'),'127.0.0.1');assert.equal(arg('--chat-template'),'deepseek-ocr');assert.equal(arg('--parallel'),'1');
if(mode==='cancel-start')setInterval(()=>{},1000);
else if(mode==='quota'){const values=[];setInterval(()=>{values.push(Buffer.alloc(32*1024*1024,1))},5);}
else{
const server=http.createServer((req,res)=>{
  if(req.headers.authorization!=='Bearer '+key){res.writeHead(401);res.end('{}');return;}
  if(req.url==='/health'){res.end(JSON.stringify({status:'ok'}));return;}
  assert.equal(req.url,'/v1/chat/completions');assert.equal(req.method,'POST');
  let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{
    const body=JSON.parse(text),content=body.messages[0].content;
    assert.equal(content[1].text,'Free OCR.');assert.match(content[0].image_url.url,/^data:image\/png;base64,/);
    assert.equal(body.stream,false);assert.equal(body.temperature,0);assert.equal(body.max_tokens,8192);
    if(mode==='hang')return;
    if(mode==='oversize'){res.writeHead(200,{'Content-Length':3*1024*1024});res.end('x');return;}
    if(mode==='redirect'){res.writeHead(302,{Location:'https://example.invalid/image'});res.end('{}');return;}
    if(mode==='malformed'){res.end('{not-json');return;}
    const choice={message:{content:'ONE OCR 2026'},finish_reason:mode==='length'?'length':'stop'};
    res.end(JSON.stringify({choices:[choice]}));
  });
});server.listen(Number(arg('--port')),'127.0.0.1',()=>{
  if(mode!=='unowned')console.error('listening on http://127.0.0.1:'+arg('--port'));
});
}
`;
async function setup(mode='normal',overrides:Partial<ConstructorParameters<typeof LlamaSession>[0]>={}){
  const directory=await mkdtemp(join(root,'control-'));
  mock.method(childProcess,'spawn',(file:any,args:any,options:any)=>{
    if(args?.[0]!=='inference-host')return (spawn as any)(file,args,options);
    return spawn(file,['inference-host',args[1],process.execPath,'-e',fixture,'--',...args.slice(3)],options);
  });
  const session=new LlamaSession({helper,executable:process.execPath,weights:join(directory,mode),projector:join(directory,'vision'),
    controlDirectory:directory,preset:deepseekOCRPresets[0],backend:'cpu',startupTimeoutMs:5000,requestTimeoutMs:5000,...overrides});
  return {session,directory};
}
const is=(kind:string)=>(error:unknown)=>error instanceof NativeInferenceError&&error.kind===kind;
test('native session authenticates loopback requests, reuses the server and cleans up idempotently',async()=>{
  const {session,directory}=await setup();
  try{
    await session.start(new AbortController().signal);
    const png=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer();
    assert.equal(await session.recognize(png,new AbortController().signal),'ONE OCR 2026');
    assert.equal(await session.recognize(png,new AbortController().signal),'ONE OCR 2026');
    assert.ok(session.alive);assert.ok(session.peakRSSMiB>=0);
    await assert.rejects(session.recognize(Buffer.alloc(33),new AbortController().signal),is('input'));assert.ok(session.alive);
    await Promise.all([session.close(),session.close()]);assert.deepEqual(await readdir(directory),[]);
  }finally{await session.close();mock.restoreAll();}
});
for(const mode of ['malformed','oversize','redirect','length'])test('native session rejects '+mode+' responses and drains its process',async()=>{
  const {session,directory}=await setup(mode);
  try{
    await session.start(new AbortController().signal);
    const png=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer();
    await assert.rejects(session.recognize(png,new AbortController().signal),is(mode==='length'?'inference':'protocol'));
    assert.equal(session.alive,false);assert.deepEqual(await readdir(directory),[]);
  }finally{await session.close();mock.restoreAll();}
});
test('native session times out when it never owns a listening socket',async()=>{
  const {session,directory}=await setup('unowned',{startupTimeoutMs:500});
  try{await assert.rejects(session.start(new AbortController().signal),is('timeout'));assert.deepEqual(await readdir(directory),[]);}
  finally{await session.close();mock.restoreAll();}
});
test('native session cancellation during startup terminates before returning',async()=>{
  const {session,directory}=await setup('cancel-start');const abort=new AbortController();
  try{
    const task=session.start(abort.signal);setTimeout(()=>abort.abort(),150);
    await assert.rejects(task,is('cancelled'));assert.deepEqual(await readdir(directory),[]);
  }finally{await session.close();mock.restoreAll();}
});
test('closing immediately during asynchronous startup leaves no process or key directory',async()=>{
  const {session,directory}=await setup();
  try{
    const starting=session.start(new AbortController().signal);void starting.catch(()=>{});
    await session.close();await assert.rejects(starting,is('cancelled'));assert.deepEqual(await readdir(directory),[]);
  }finally{await session.close();mock.restoreAll();}
});
test('a missing executable reports startup failure and cleans its private directory',async()=>{
  const {session,directory}=await setup('normal',{helper:join(root,'missing-helper.exe')});
  try{await assert.rejects(session.start(new AbortController().signal),is('loading'));assert.deepEqual(await readdir(directory),[]);}
  finally{await session.close();mock.restoreAll();}
});
for(const mode of ['timeout','cancel'])test('native session '+mode+' during inference frees its image owner',async()=>{
  const {session,directory}=await setup('hang',{requestTimeoutMs:mode==='timeout'?150:5000});const abort=new AbortController();
  try{
    await session.start(abort.signal);const png=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer();
    const task=session.recognize(png,abort.signal);if(mode==='cancel')setTimeout(()=>abort.abort(),100);
    await assert.rejects(task,is(mode==='timeout'?'timeout':'cancelled'));assert.deepEqual(await readdir(directory),[]);
  }finally{await session.close();mock.restoreAll();}
});
test('native session reports a hard Windows memory quota',async()=>{
  const {session,directory}=await setup('quota',{memoryMiB:128});
  try{await assert.rejects(session.start(new AbortController().signal),is('resource'));assert.deepEqual(await readdir(directory),[]);}
  finally{await session.close();mock.restoreAll();}
});
