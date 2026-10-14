import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import sharp from 'sharp';
import {OneAIService} from '../../src/main/ai-service';
import {prepareAITask,taskTranslation,type AITaskReference} from '../../src/shared/ai-task';
import type {AIKind,AIProfileInput} from '../../src/shared/ai';
import type {CodexProvider} from '../../src/main/codex-provider';
const root=process.env.ONE_RECOGNITION_TEST_ROOT!;
const secret='fixture-private-key';
const config=(kind:AIKind='openai'):AIProfileInput=>({name:'Fixture',kind,baseUrl:kind==='codex'?'codex://local':kind==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:48230/v1',model:'model-a',models:[{id:'model-a',name:'Model A'}],maxTokens:256,timeoutSeconds:5,temperature:null,tokenField:'max_completion_tokens',apiKey:kind==='codex'?undefined:secret});
const reference=(service:OneAIService):AITaskReference=>{const profile=service.taskProfiles()[0];return {profileId:profile.id,model:profile.model,revision:profile.revision};};
const request=(reference:AITaskReference,owner=1)=>({owner,reference,purpose:'translation' as const,target:'zh-Hans' as const,paragraphs:[{id:'p1',text:'One'}]});
const translated=JSON.stringify({paragraphs:[{id:'p1',text:'一'}]});
const response=(text:string,kind:AIKind='openai')=>new Response(JSON.stringify(kind==='ollama'?{model:'actual-model',message:{content:text},done:true}:{model:'actual-model',choices:[{message:{content:text}}]}),{headers:{'content-type':'application/json'}});
async function fixture(options:ConstructorParameters<typeof OneAIService>[2],action:(service:OneAIService,directory:string)=>Promise<void>){
  const directory=await mkdtemp(join(root,'ai-task-')),service=new OneAIService(directory,()=>{},options);
  try{await action(service,directory);}finally{service.dispose();const path=await realpath(directory);assert.equal(dirname(path),await realpath(root));await rm(path,{recursive:true,force:true});}
}
const image=async()=>({name:'probe.png',png:(await sharp(Buffer.from('<svg width="360" height="90"><rect width="360" height="90" fill="white"/><text x="24" y="64" font-family="Arial" font-size="48">123456</text></svg>')).png().toBuffer()).toString('base64')});
async function until(check:()=>boolean){const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Fixture did not start');await new Promise(resolve=>setTimeout(resolve,5));}}

test('feature requests expose only fixed purposes, exact paragraph identities, model references and explicit image intent',()=>{
  const ref={profileId:'legacy-profile',model:'model-a',revision:'a'.repeat(64)},input=request(ref),prepared=prepareAITask(input);
  assert.deepEqual(JSON.parse(prepared.messages[1].content).paragraphs,input.paragraphs);assert.equal(prepared.messages[1].images,undefined);
  for(const value of [{...input,prompt:'execute commands'},{...input,messages:[]},{...input,image:undefined},{...input,owner:0},{...input,sourceLanguage:0},{...input,paragraphs:[{id:'a',text:'A'},{id:'a',text:'B'}]},{...input,paragraphs:[{id:'a',text:'x'.repeat(20001)}]}])assert.throws(()=>prepareAITask(value));
});
test('missing/duplicate/extra/reordered translation IDs keep valid paragraphs and restore input order',()=>{
  const expected=[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'}];
  const result=taskTranslation(JSON.stringify({paragraphs:[{id:'b',text:'乙'},{id:'a',text:'甲'},{id:'unknown',text:'extra'}]}),expected);
  assert.deepEqual(result.paragraphs,[{id:'a',text:'甲'},{id:'b',text:'乙'},{id:'c',error:'服务未返回该段落'}]);assert.deepEqual(result.unexpectedIds,['unknown']);assert.equal(result.reordered,true);
  const duplicate=taskTranslation(JSON.stringify({paragraphs:[{id:'a',text:'甲'},{id:'a',text:'重复'},{id:'c',text:'丙'}]}),expected);assert.deepEqual(duplicate.paragraphs[2],{id:'c',text:'丙'});assert.match((duplicate.paragraphs[0] as {error:string}).error,/重复/);
  assert.equal(taskTranslation(JSON.stringify({paragraphs:[{id:'b',text:'乙'}]}),expected).reordered,false);
  assert.throws(()=>taskTranslation('plain reply',expected));assert.throws(()=>taskTranslation('x'.repeat(60001),expected));
});
test('OpenAI compatible, Ollama and LM Studio feature calls reuse profile settings/keys, report wire model and create no history',async()=>{
  for(const kind of ['openai','ollama','lmstudio'] as const){const calls:{url:string;body:any;headers:Headers}[]=[];
    await fixture({transport:async(input,init)=>{calls.push({url:String(input),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});return response(translated,kind);}},async(service,directory)=>{
      await service.profile(config(kind));const before=await readFile(join(directory,'ai-data.json'),'utf8'),ref=reference(service);
      assert.ok(!JSON.stringify(service.taskProfiles()).includes(secret));assert.ok(!JSON.stringify(service.taskProfiles()).includes('encrypted'));
      const result=await service.runTask(request(ref));assert.equal(result.purpose,'translation');if(result.purpose==='translation')assert.deepEqual(result.result.paragraphs,[{id:'p1',text:'一'}]);assert.equal(result.model,'actual-model');
      assert.equal(calls[0].headers.get('authorization'),'Bearer '+secret);assert.equal(calls[0].body.model,'model-a');assert.equal(calls[0].body.stream,true);
      assert.equal(calls[0].url,kind==='ollama'?'http://127.0.0.1:11434/api/chat':'http://127.0.0.1:48230/v1/chat/completions');
      if(kind==='ollama')assert.equal(calls[0].body.options.num_predict,256);else assert.equal(calls[0].body.max_completion_tokens,256);
      assert.equal(calls[0].body.messages.length,2);assert.equal(typeof calls[0].body.messages[1].content,'string');assert.equal(calls[0].body.messages[1].images,undefined);
      assert.deepEqual(service.state().history,[]);assert.deepEqual(service.state().conversations,[]);assert.equal(await readFile(join(directory,'ai-data.json'),'utf8'),before);
    });
  }
});
test('Codex feature requests use the existing ephemeral transform adapter and pass image only after verification',async()=>{
  const calls:any[]=[];const png=await image();
  const codex={generate:async(_profile:unknown,messages:any[],_signal:AbortSignal,picture:unknown,options:unknown)=>{calls.push({messages,picture,options});return {text:picture?messages[0].content.includes('six digits')?'123456':'x+1':translated,model:'codex-actual'};},dispose(){}} as unknown as CodexProvider;
  await fixture({codex,imageProbe:async()=>({image:png,expected:'123456'})},async service=>{
    await service.profile(config('codex'));const ref=reference(service);await service.runTask(request(ref));assert.equal(calls[0].options.chat,false);assert.equal(calls[0].picture,undefined);
    await assert.rejects(service.runTask({owner:2,reference:ref,purpose:'formula',image:png}),/验证/);assert.equal(calls.length,1);
    await service.verifyTaskImageInput(ref,2);const result=await service.runTask({owner:2,reference:ref,purpose:'formula',image:png});assert.equal(result.purpose,'formula');assert.equal(calls[2].picture,png.png);assert.equal(calls[2].options.chat,false);
    assert.deepEqual(service.state().conversations,[]);assert.deepEqual(service.state().history,[]);
  });
});
test('SSE and Ollama NDJSON feature replies retain structured paragraph IDs and the streamed model identity',async()=>{
  for(const kind of ['openai','ollama'] as const){const chunks=[translated.slice(0,15),translated.slice(15)];
    const text=kind==='ollama'?chunks.map((content,index)=>JSON.stringify({model:'streamed-model',message:{content},done:index===1})+'\n').join(''):chunks.map((content,index)=>'data: '+JSON.stringify({model:'streamed-model',choices:[{delta:{content},finish_reason:index===1?'stop':null}]})+'\n\n').join('')+'data: [DONE]\n\n';
    await fixture({transport:async()=>new Response(text,{headers:{'content-type':kind==='ollama'?'application/x-ndjson':'text/event-stream'}})},async service=>{
      await service.profile(config(kind));const result=await service.runTask(request(reference(service)));assert.equal(result.model,'streamed-model');if(result.purpose!=='translation')throw Error('Wrong task');assert.deepEqual(result.result.paragraphs,[{id:'p1',text:'一'}]);
    });
  }
});
test('a real PNG challenge confirms exact profile/model, keeps answer out of prompt and invalidates on profile edits',async()=>{
  const png=await image(),bodies:any[]=[];
  await fixture({imageProbe:async()=>({image:png,expected:'123456'}),transport:async(_input,init)=>{const body=JSON.parse(String(init?.body));bodies.push(body);return response(body.messages[0].content.includes('six digits')?'123456':'\\frac{a}{b}');}},async(service,directory)=>{
    await service.profile(config());const ref=reference(service);await assert.rejects(service.runTask({owner:1,reference:ref,purpose:'formula',image:png}),/验证/);assert.equal(bodies.length,0);
    await service.verifyTaskImageInput(ref,1);assert.ok(!JSON.stringify(bodies[0].messages.map((message:any)=>message.content)).includes('123456'));
    assert.equal(bodies[0].messages[1].content[1].image_url.url,'data:image/png;base64,'+png.png);assert.deepEqual(service.taskProfiles()[0].imageModels,['model-a']);
    const result=await service.runTask({owner:1,reference:ref,purpose:'formula',image:png});if(result.purpose!=='formula')throw Error('Wrong task');assert.equal(result.text,'\\frac{a}{b}');
    assert.deepEqual(service.state().conversations,[]);const saved=JSON.parse(await readFile(join(directory,'ai-data.json'),'utf8'));assert.equal(saved.taskVision[ref.profileId].revision,ref.revision);assert.ok(!JSON.stringify(saved).includes(secret));
    await service.profile({...config(),id:ref.profileId,apiKey:'new-fixture-key'});assert.notEqual(reference(service).revision,ref.revision);assert.deepEqual(service.taskProfiles()[0].imageModels,[]);await assert.rejects(service.runTask(request(ref)),/已改变/);
  });
});
test('incorrect image responses never mark a text-only model as image-capable',async()=>{
  const png=await image();await fixture({imageProbe:async()=>({image:png,expected:'123456'}),transport:async()=>response('I cannot read images')},async service=>{
    await service.profile(config());await assert.rejects(service.verifyTaskImageInput(reference(service),1),/未正确读取/);assert.deepEqual(service.taskProfiles()[0].imageModels,[]);
  });
});
test('feature tasks share the three-request limit and owner cancellation leaves other windows running',async()=>{
  const pending:{signal:AbortSignal;resolve:(response:Response)=>void}[]=[];
  await fixture({transport:async(_input,init)=>new Promise<Response>((resolve,reject)=>{const signal=init!.signal!;pending.push({signal,resolve});signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})},async service=>{
    await service.profile(config());const ref=reference(service),a=service.runTask(request(ref,1)),b=service.runTask(request(ref,2)),c=service.runTask(request(ref,3));await until(()=>pending.length===3);
    await assert.rejects(service.runTask(request(ref,4)),/太多/);service.cancelTaskOwner(99);assert.ok(pending.every(call=>!call.signal.aborted));
    service.cancelTaskOwner(2);await assert.rejects(b,/取消/);assert.equal(pending[0].signal.aborted,false);assert.equal(pending[2].signal.aborted,false);pending[0].resolve(response(translated));pending[2].resolve(response(translated));await Promise.all([a,c]);
  });
});
test('profile changes during a request discard old output without sending data to the new endpoint',async()=>{
  const pending:{url:string;resolve:(response:Response)=>void}[]=[];
  await fixture({transport:async(input)=>new Promise<Response>(resolve=>pending.push({url:String(input),resolve}))},async service=>{
    await service.profile(config());const ref=reference(service),task=service.runTask(request(ref));await until(()=>pending.length===1);
    await service.profile({...config(),id:ref.profileId,baseUrl:'http://127.0.0.1:48231/v1'});pending[0].resolve(response(translated));await assert.rejects(task,/已改变/);assert.equal(pending.length,1);assert.equal(pending[0].url,'http://127.0.0.1:48230/v1/chat/completions');
  });
});
test('cancelled preprocessing sends no image and bounded JSON responses cancel their reader',async()=>{
  const png=await image();let release!:(value:{image:typeof png;expected:string})=>void,calls=0;
  await fixture({imageProbe:()=>new Promise(resolve=>{release=resolve;}),transport:async()=>{calls++;return response('123456');}},async service=>{
    await service.profile(config());const task=service.verifyTaskImageInput(reference(service),5);await until(()=>!!release);service.cancelTaskOwner(5);release({image:png,expected:'123456'});await assert.rejects(task,/取消/);assert.equal(calls,0);
  });
  let cancelled=false;await fixture({transport:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})},async service=>{
    await service.profile(config());await assert.rejects(service.runTask(request(reference(service))),/响应过大/);assert.equal(cancelled,true);
  });
});
