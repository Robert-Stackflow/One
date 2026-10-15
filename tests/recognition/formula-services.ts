import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm,rename,mkdir,rmdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {OneAIService} from '../../src/main/ai-service';
import {FormulaServices} from '../../src/main/formula-services';
import {serviceCredentialCrypto} from '../../src/main/service-connections';
import {RecognitionConnectionStore} from '../../src/main/recognition/connections';
import {SimpleTexClient,simpletexHeaders} from '../../src/main/recognition/simpletex-client';
import {formulaServiceInput,formulaServiceEndpoint,formulaServiceReference,type FormulaServiceInput} from '../../src/shared/recognition/formula-services';
const root=resolve(process.env.ONE_RECOGNITION_TEST_ROOT!),secret='formula-service-private-secret';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const input=(mode:'standard'|'turbo'='standard'):FormulaServiceInput=>({name:'Formula fixture',provider:'simpletex',mode,appId:'personal-app-id',appSecret:secret,timeoutSeconds:5});
const response=(value:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json',...headers}});
const ref=(profile:{id:string;revision:string})=>({serviceId:profile.id,revision:profile.revision});
async function fixture(action:(ai:OneAIService,directory:string)=>Promise<void>,transport?:typeof fetch){
  const directory=await mkdtemp(join(root,'formula-services-')),ai=new OneAIService(directory,()=>{},{formulaTransport:transport,translationTransport:transport,transport});
  try{await action(ai,directory);}finally{ai.dispose();const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));await rm(actual,{recursive:true,force:true});}
}
async function until(check:()=>boolean){const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)throw Error('Fixture not ready');await new Promise(resolve=>setTimeout(resolve,5));}}
test('SimpleTex signature matches the official APP fixture and standard/turbo send only a signed PNG file',async()=>{
  assert.throws(()=>formulaServiceReference({serviceId:'bad',revision:'bad'}),/公式服务引用无效/);
  assert.equal(simpletexHeaders('19X4f10YM1Va894nvFl89ikY','fu4Wfmna4153DFN12ctBsPqgVI3vvGGK',{use_batch:'True'},'1675550577','mSkYSY28N4WkvidB').sign,'5f271e1deccd95d467c7dd430ca2c8b1');
  for(const mode of ['standard','turbo'] as const){let calls=0;await fixture(async ai=>{
    const profile=ai.formulators.save(input(mode)),before=ai.state(),result=await ai.recognizeDedicatedFormula(ref(profile),1,png);assert.equal(result.text,'x^{2}');assert.equal(result.confidence,0);assert.equal(result.requestId,'test-request');assert.equal(result.model,undefined);assert.equal(result.endpoint,formulaServiceEndpoint(mode));assert.equal(calls,1);assert.deepEqual(ai.state(),before);
  },async(url,init)=>{calls++;assert.equal(String(url),formulaServiceEndpoint(mode));assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');const headers=new Headers(init?.headers);assert.equal(headers.has('authorization'),false);assert.equal(headers.has('content-type'),false);assert.match(headers.get('random-str')!,/^[a-z\d]{16}$/i);assert.match(headers.get('timestamp')!,/^\d+$/);assert.equal(headers.get('sign'),simpletexHeaders('personal-app-id',secret,{},headers.get('timestamp')!,headers.get('random-str')!).sign);assert.equal(headers.has('secret'),false);
    const form=init!.body as FormData;assert.deepEqual([...form.keys()],['file']);const file=form.get('file') as File;assert.equal(file.name,'formula.png');assert.equal(file.type,'image/png');assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);return response({status:true,res:{latex:'x^{2}',conf:0},request_id:'test-request'});
  });}
});
test('formula registry encrypts only credentials, preserves blank secrets and rejects stale edits or account changes',()=>fixture(async(ai,directory)=>{
  const profile=ai.formulators.save(input());assert.equal(JSON.stringify(profile).includes(secret),false);assert.equal(JSON.stringify(profile).includes('encrypted'),false);assert.equal((await readFile(join(directory,'ai-data.json'),'utf8')).includes(secret),false);
  const updated=ai.formulators.save({...input('turbo'),id:profile.id,revision:profile.revision,appSecret:''});assert.equal(ai.formulators.connection(ref(updated)).key,secret);assert.throws(()=>ai.formulators.save({...input(),id:profile.id,revision:profile.revision}),/已改变/);assert.throws(()=>ai.formulators.save({...input(),id:profile.id,revision:updated.revision,appId:'another-app',appSecret:''}),/重新填写/);
  const reopened=new OneAIService(directory,()=>{});try{assert.equal(reopened.formulators.connection(ref(updated)).key,secret);}finally{reopened.dispose();}
  assert.throws(()=>formulaServiceInput({...input(),endpoint:'https://untrusted.example'}),/无效/);assert.throws(()=>formulaServiceInput({...input(),appId:'bad id'}),/无效/);
  const previous=ai.formulators.list();ai.formulators.remove(updated.id,updated.revision);assert.equal(ai.formulators.list().length,0);assert.throws(()=>ai.formulators.assertReference(ref(previous[0])),/已删除/);
}));
test('formula credential encryption and persistence failures cannot silently replace a saved service',()=>{
  let records:unknown;const registry=new FormulaServices(()=>records,value=>{records=value;},serviceCredentialCrypto),saved=registry.save(input()),original=structuredClone(records);
  const failed=new FormulaServices(()=>records,()=>{throw Error('persist failed');},serviceCredentialCrypto);assert.throws(()=>failed.save({...input(),id:saved.id,revision:saved.revision,name:'new'}),/persist/);assert.deepEqual(records,original);
  const bad=new FormulaServices(()=>undefined,()=>assert.fail('must not write'),{available:()=>true,encrypt:()=>Buffer.alloc(20000),decrypt:()=>secret});assert.throws(()=>bad.save(input()),/无法加密/);
  const unavailable=new FormulaServices(()=>records,()=>assert.fail('must not write'),{...serviceCredentialCrypto,available:()=>false});assert.throws(()=>unavailable.save({...input(),id:saved.id,revision:saved.revision}),/系统加密/);assert.deepEqual(records,original);
});
test('One formula registry rolls back failed disk persistence',()=>fixture(async(ai,directory)=>{
  const profile=ai.formulators.save(input()),before=ai.formulators.list(),file=join(directory,'ai-data.json'),backup=file+'.saved';await rename(file,backup);await mkdir(file);
  try{assert.throws(()=>ai.formulators.save({...input(),id:profile.id,revision:profile.revision,name:'must not replace'}));assert.deepEqual(ai.formulators.list(),before);}finally{await rmdir(file);await rename(backup,file);}
}));
test('dedicated formula bindings isolate translation services and follow edits/deletion without exposing keys',()=>fixture(async ai=>{
  const profile=ai.formulators.save(input()),text=ai.translators.save({name:'text',provider:'azure',plan:'pro',region:'',timeoutSeconds:5,apiKey:secret}),formula=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'formula',ai),translation=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai);
  await assert.rejects(formula.save({revision:(await formula.state()).revision,provider:'service',endpoint:'',model:'',region:'',serviceReference:ref(text)}),/已删除|已改变/);await assert.rejects(translation.save({revision:(await translation.state()).revision,provider:'service',endpoint:'',model:'',region:'',serviceReference:ref(profile)}),/已改变/);
  const saved=await formula.save({revision:(await formula.state()).revision,provider:'service',endpoint:'',model:'',region:'',serviceReference:ref(profile)});assert.equal(saved.ready,true);assert.equal((await formula.connection(saved.revision)).key,'');
  const reopened=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'formula',ai);assert.equal((await reopened.state()).ready,true);assert.deepEqual((await reopened.connection((await reopened.state()).revision)).serviceReference,ref(profile));
  const updated=ai.formulators.save({...input('turbo'),id:profile.id,revision:profile.revision,appSecret:''});assert.notEqual((await formula.state()).revision,saved.revision);ai.formulators.remove(updated.id,updated.revision);assert.equal((await formula.state()).ready,false);
}));
test('SimpleTex rejects malformed, oversized or failed output and never echoes error bodies or transport credentials',async()=>{
  for(const value of [{status:false,message:secret},{status:true,res:{latex:'x',conf:'95'}},{status:true,res:{latex:'x',conf:1.1}},{status:true,res:{latex:'\0'}},{status:true,res:{latex:''}}])await fixture(async ai=>{const profile=ai.formulators.save(input());await assert.rejects(ai.recognizeDedicatedFormula(ref(profile),1,png),error=>!String(error).includes(secret));},async()=>response(value));
  for(const status of [401,402,413,429,500])await fixture(async ai=>{const profile=ai.formulators.save(input());await assert.rejects(ai.recognizeDedicatedFormula(ref(profile),1,png),error=>!String(error).includes(secret));},async()=>new Response(secret,{status}));
  await fixture(async ai=>{const profile=ai.formulators.save(input());await assert.rejects(ai.recognizeDedicatedFormula(ref(profile),1,png),error=>!String(error).includes(secret));},async()=>{throw Error('配置已改变 '+secret);});
  let cancelled=0;await fixture(async ai=>{const profile=ai.formulators.save(input());await assert.rejects(ai.recognizeDedicatedFormula(ref(profile),1,png),/过大/);assert.equal(cancelled,1);},async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-length':'524289'}}));
});
test('SimpleTex closes pending readers on cancel, rejects late config results and never invents confidence',async()=>{
  let started=false,cancelled=0;await fixture(async ai=>{const profile=ai.formulators.save(input()),pending=ai.recognizeDedicatedFormula(ref(profile),7,png);void pending.catch(()=>{});await until(()=>started);ai.cancelTaskOwner(7);await assert.rejects(pending,/已取消/);assert.equal(cancelled,1);},async()=>{started=true;return new Response(new ReadableStream({cancel(){cancelled++;}}));});
  await fixture(async ai=>{const profile=ai.formulators.save(input()),client=new SimpleTexClient(ai.formulators,async()=>{ai.formulators.save({...input('turbo'),id:profile.id,revision:profile.revision});return response({status:true,res:{latex:'x'}});});await assert.rejects(client.run(ref(profile),png,new AbortController().signal),/配置已改变/);});
  await fixture(async ai=>{const profile=ai.formulators.save(input()),result=await ai.recognizeDedicatedFormula(ref(profile),1,png);assert.equal(Object.hasOwn(result,'confidence'),false);assert.equal(Object.hasOwn(result,'requestId'),false);},async()=>response({status:true,res:{latex:'x'}}));
});
test('SimpleTex streaming capacity, invalid UTF-8 and timeout close response readers without retrying',async()=>{
  let records:unknown;const registry=new FormulaServices(()=>records,value=>{records=value;},serviceCredentialCrypto),profile=registry.save(input());let calls=0,cancelled=0;
  const large=new SimpleTexClient(registry,async()=>{calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(524289));},cancel(){cancelled++;}}));});await assert.rejects(large.run(ref(profile),png,new AbortController().signal),/过大/);assert.equal(cancelled,1);assert.equal(calls,1);
  const invalid=new SimpleTexClient(registry,async()=>new Response(new Uint8Array([255,254])));await assert.rejects(invalid.run(ref(profile),png,new AbortController().signal),/格式无效/);
  class FastTimeout extends FormulaServices {override connection(value:unknown){return {...super.connection(value),timeoutSeconds:.02};}}
  const fast=new FastTimeout(()=>records,value=>{records=value;},serviceCredentialCrypto),keepAlive=setTimeout(()=>{},1000);cancelled=0;
  try{const client=new SimpleTexClient(fast,async()=>new Response(new ReadableStream({cancel(){cancelled++;}})));await assert.rejects(client.run(ref(profile),png,new AbortController().signal),/超时/);assert.equal(cancelled,1);}finally{clearTimeout(keepAlive);}
});
test('dedicated formula, text translation and AI calls share three tasks and cancel by owning window',async()=>{
  let calls=0,cancelled=0;await fixture(async ai=>{
    await ai.profile({name:'AI',kind:'openai',baseUrl:'https://ai.example/v1',model:'m',models:[{id:'m',name:'m'}],maxTokens:256,timeoutSeconds:5,temperature:0,tokenField:'max_tokens',apiKey:secret});const task=ai.taskProfiles()[0],profile=ai.formulators.save(input()),text=ai.translators.save({name:'text',provider:'azure',plan:'pro',region:'',timeoutSeconds:5,apiKey:secret});
    const pending=[ai.recognizeDedicatedFormula(ref(profile),1,png),ai.translateBatch(ref(text),2,[{id:'p1',text:'hello'}],'en'),ai.runTask({owner:3,reference:{profileId:task.id,model:'m',revision:task.revision},purpose:'translation',target:'en',paragraphs:[{id:'p1',text:'hello'}]})];pending.forEach(p=>void p.catch(()=>{}));await until(()=>calls===3);await assert.rejects(ai.recognizeDedicatedFormula(ref(profile),4,png),/太多/);for(const owner of [1,2,3])ai.cancelTaskOwner(owner);await Promise.allSettled(pending);assert.equal(cancelled,3);assert.deepEqual(ai.state().history,[]);assert.deepEqual(ai.state().conversations,[]);
  },async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});});
});
