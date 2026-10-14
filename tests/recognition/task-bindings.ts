import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import sharp from 'sharp';
import {OneAIService} from '../../src/main/ai-service';
import {RecognitionConnectionStore} from '../../src/main/recognition/connections';
import {serviceCredentialCrypto} from '../../src/main/service-connections';
import {RecognitionTaskProvider} from '../../src/main/recognition/task-provider';
import {TranslationClient} from '../../src/main/recognition/translation-client';
import {FormulaClient} from '../../src/main/recognition/formula-client';
import {InlineOCRSessions} from '../../src/main/recognition/inline-ocr';
import type {AITaskReference} from '../../src/shared/ai-task';
const root=resolve(process.env.ONE_RECOGNITION_TEST_ROOT!),secret='private-migration-fixture';
const legacy={provider:'chat' as const,endpoint:'https://binding.example/v1/chat/completions',model:'model-a',region:'',key:secret};
const settings=(revision:string,reference:AITaskReference)=>({revision,provider:'ai' as const,reference,endpoint:'',region:'',model:reference.model});
async function fixture(action:(ai:OneAIService,store:RecognitionConnectionStore,directory:string)=>Promise<void>,options:ConstructorParameters<typeof OneAIService>[2]={}){
  const directory=await mkdtemp(join(root,'task-binding-')),ai=new OneAIService(directory,()=>{},options),store=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai);
  try{await action(ai,store,directory);}finally{ai.dispose();const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));await rm(actual,{recursive:true,force:true});}
}
test('migration preserves legacy until explicit binding, reuses profile, keeps chat default and encrypted rollback',()=>fixture(async(ai,store,directory)=>{
  const defaultId=ai.state().defaultId,saved=await store.save({...legacy,revision:(await store.state()).revision}),ref=await store.migrateLegacy(saved.revision);
  assert.equal(ai.state().defaultId,defaultId);assert.equal((await store.state()).provider,'chat');assert.equal((await store.connection(saved.revision)).key,secret);
  assert.deepEqual(await store.migrateLegacy(saved.revision),ref);assert.equal(ai.taskProfiles().length,1);
  const bound=await store.save(settings(saved.revision,ref));assert.equal(bound.ready,true);assert.equal(bound.provider,'ai');assert.equal(bound.canRestoreLegacy,true);
  const persisted=await readFile(join(directory,'ai-data.json'),'utf8');assert.equal(persisted.includes(secret),false);assert.equal(JSON.stringify(bound).includes('encrypted'),false);
  const fresh=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai);assert.equal((await fresh.state()).revision,bound.revision);
  const restored=await fresh.restoreLegacy(bound.revision);assert.equal(restored.provider,'chat');assert.equal((await fresh.connection(restored.revision)).key,secret);
  await assert.rejects(fresh.connection(saved.revision),/改变/);
}));
test('noncanonical endpoints are retained and Azure migration keeps the active legacy connection until binding',()=>fixture(async(ai,store)=>{
  let saved=await store.save({...legacy,endpoint:'https://binding.example/custom/completions',revision:(await store.state()).revision});
  await assert.rejects(store.migrateLegacy(saved.revision),/原配置已保留/);assert.equal((await store.connection(saved.revision)).key,secret);assert.equal(ai.taskProfiles().length,0);
  saved=await store.save({...legacy,provider:'azure',revision:saved.revision});const migrated=await store.migrateLegacy(saved.revision);assert.ok('serviceId' in migrated);assert.equal((await store.connection(saved.revision)).provider,'azure');assert.equal(ai.translators.list().length,1);assert.equal(ai.taskProfiles().length,0);
}));
test('profile edits invalidate public binding revision and stale saves/results without copying credentials',()=>fixture(async(ai,store)=>{
  const ref=await ai.importRecognitionConnection(legacy.endpoint,legacy.model,secret,'Task profile'),bound=await store.save(settings((await store.state()).revision,ref)),profile=ai.state().profiles[0];
  await ai.profile({...profile,apiKey:'replacement-fixture'});const changed=await store.state();assert.notEqual(changed.revision,bound.revision);assert.equal(changed.ready,true);
  await assert.rejects(store.connection(bound.revision),/改变/);await assert.rejects(store.save(settings(changed.revision,ref)),/已改变/);
  assert.notEqual(changed.reference!.revision,ref.revision);assert.equal((await store.connection(changed.revision)).key,'');
}));
test('failed binding persistence does not replace legacy or its restore key',()=>fixture(async(ai,store)=>{
  const saved=await store.save({...legacy,revision:(await store.state()).revision}),ref=await store.migrateLegacy(saved.revision),storage=ai.serviceConnections();
  const broken=new RecognitionConnectionStore({...storage,write:async()=>{throw Error('fixture write failed');}},serviceCredentialCrypto,'translation',ai);
  await assert.rejects(broken.save(settings(saved.revision,ref)),/write failed/);assert.equal((await broken.connection(saved.revision)).key,secret);assert.equal((await store.state()).revision,saved.revision);
}));
test('failed credential encryption leaves no partially imported AI profile',()=>fixture(async(ai,store)=>{
  const saved=await store.save({...legacy,revision:(await store.state()).revision}),before=ai.state(),encrypt=serviceCredentialCrypto.encrypt;
  serviceCredentialCrypto.encrypt=()=>{throw Error('private failure');};
  try{await assert.rejects(store.migrateLegacy(saved.revision),/^Error: 迁入服务密钥无法加密，原配置已保留$/);assert.deepEqual(ai.state(),before);assert.equal((await store.connection(saved.revision)).key,secret);}finally{serviceCredentialCrypto.encrypt=encrypt;}
}));
test('feature clients use fixed AI tasks, report actual model, never invoke legacy transport or add chat history',()=>fixture(async(ai,store)=>{
  const ref=await ai.importRecognitionConnection(legacy.endpoint,legacy.model,secret,'Task profile'),bound=await store.save(settings((await store.state()).revision,ref));
  const tasks=new RecognitionTaskProvider(ai,()=>71),client=new TranslationClient(async()=>{throw Error('legacy called');},1,tasks);
  const result=await client.run(await store.connection(bound.revision),'Hello','zh-Hans');assert.equal(result.text,'你好');assert.equal(result.model,'wire-model');assert.deepEqual(ai.state().conversations,[]);
},{transport:async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.messages.length,2);assert.equal(body.messages[1].images,undefined);assert.deepEqual(JSON.parse(body.messages[1].content).paragraphs,[{id:'source',text:'Hello'}]);return new Response(JSON.stringify({model:'wire-model',choices:[{message:{content:JSON.stringify({paragraphs:[{id:'source',text:'你好'}]})}}]}),{headers:{'content-type':'application/json'}});}}));
test('formula bindings require verified image capability and reject expired capability before sending',async()=>{
  const png=await sharp({create:{width:32,height:32,channels:3,background:'white'}}).png().toBuffer(),image={name:'probe.png',png:png.toString('base64')};let calls=0;
  await fixture(async(ai,_store)=>{
    const store=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'formula',ai),ref=await ai.importRecognitionConnection(legacy.endpoint,legacy.model,secret,'Vision'),initial=await store.state();
    await assert.rejects(store.save(settings(initial.revision,ref)),/验证/);assert.equal(calls,0);await ai.verifyTaskImageInput(ref,72);
    const bound=await store.save(settings(initial.revision,ref)),client=new FormulaClient(async()=>{throw Error('legacy called');},1,new RecognitionTaskProvider(ai,()=>72));
    const result=await client.run(await store.connection(bound.revision),png);assert.equal(result.text,'x^2');assert.equal(result.model,'wire-vision');assert.equal(calls,2);
    const now=Date.now;Date.now=()=>now()+86400001;try{const expired=await store.state();assert.equal(expired.ready,false);assert.notEqual(expired.revision,bound.revision);await assert.rejects(store.connection(expired.revision),/验证/);assert.equal(calls,2);}finally{Date.now=now;}
  },{imageProbe:async()=>({image,expected:'123456'}),transport:async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.ok(body.messages[1].content.some((item:any)=>item.type==='image_url'));return new Response(JSON.stringify({model:'wire-vision',choices:[{message:{content:calls===1?'123456':'x^2'}}]}),{headers:{'content-type':'application/json'}});}});
});
test('inline AI translation uses its actual owner, cancels on owner close and rejects changed feature bindings',async()=>{
  const png=await sharp({create:{width:32,height:32,channels:3,background:'white'}}).png().toBuffer();let started=false,finish:(()=>void)|undefined;
  await fixture(async(ai,store)=>{
    const ref=await ai.importRecognitionConnection(legacy.endpoint,legacy.model,secret,'Inline'),bound=await store.save(settings((await store.state()).revision,ref));
    const sessions=new InlineOCRSessions(()=>({run:async()=>{throw Error('Unexpected OCR');},cancel:async()=>{},close:async()=>{}}),async()=>store.connection((await store.state()).revision),owner=>new TranslationClient(undefined,undefined,new RecognitionTaskProvider(ai,()=>owner)));
    try{
      const image=await sessions.prepare(92,'source',png.toString('base64')),cancelled=sessions.translate(92,image.id,'Hello','zh-Hans');void cancelled.catch(()=>{});
      const deadline=Date.now()+3000;while(!started){if(Date.now()>deadline)throw Error('Transport not started');await new Promise(resolve=>setTimeout(resolve,5));}ai.cancelTaskOwner(92);await assert.rejects(cancelled);
      started=false;const pending=sessions.translate(92,image.id,'Hello','zh-Hans');void pending.catch(()=>{});while(!started){if(Date.now()>deadline)throw Error('Transport not started');await new Promise(resolve=>setTimeout(resolve,5));}
      await store.save(settings(bound.revision,ref));finish!();await assert.rejects(pending,/翻译服务已改变/);
    }finally{await sessions.stop();}
  },{transport:async(_url,init)=>{started=true;return new Promise<Response>((resolve,reject)=>{const abort=()=>reject(Error('Fixture cancelled'));init!.signal!.addEventListener('abort',abort,{once:true});finish=()=>{init!.signal!.removeEventListener('abort',abort);resolve(new Response(JSON.stringify({choices:[{message:{content:'{"paragraphs":[{"id":"source","text":"你好"}]}'}}]}),{headers:{'content-type':'application/json'}}));};});}});
});
