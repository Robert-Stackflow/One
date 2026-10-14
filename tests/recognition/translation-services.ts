import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm,mkdir,rmdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {OneAIService} from '../../src/main/ai-service';
import {TranslationServices} from '../../src/main/translation-services';
import {serviceCredentialCrypto} from '../../src/main/service-connections';
import {RecognitionConnectionStore} from '../../src/main/recognition/connections';
import {TranslationClient} from '../../src/main/recognition/translation-client';
import {RecognitionTaskProvider} from '../../src/main/recognition/task-provider';
import {formulaSettings} from '../../src/shared/recognition/formula';
import {translationServiceEndpoint,translationServiceInput,type DedicatedTranslationKind,type TranslationServiceInput,type TranslationServiceReference} from '../../src/shared/recognition/translation-services';
const root=resolve(process.env.ONE_RECOGNITION_TEST_ROOT!),secret='dedicated-fixture-key';
const input=(provider:DedicatedTranslationKind='azure',plan:'free'|'pro'='pro'):TranslationServiceInput=>({name:'Dedicated fixture',provider,plan,region:provider==='azure'?'eastasia':'',timeoutSeconds:5,apiKey:secret});
const reference=(ai:OneAIService,id:string)=>ai.translators.reference(id);
const response=(value:unknown,headers?:Record<string,string>)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json',...headers}});
async function fixture(action:(ai:OneAIService,directory:string)=>Promise<void>,transport?:typeof fetch,aiTransport?:typeof fetch){
  const directory=await mkdtemp(join(root,'translation-services-')),ai=new OneAIService(directory,()=>{},{translationTransport:transport,transport:aiTransport});try{await action(ai,directory);}finally{ai.dispose();const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));await rm(actual,{recursive:true,force:true});}
}
async function until(check:()=>boolean){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('Fixture not started');await new Promise(resolve=>setTimeout(resolve,5));}}
test('Azure, DeepL Free/Pro and Google Basic use native protocols, script targets, header credentials and ordered IDs',async()=>{
  for(const [provider,plan] of [['azure','pro'],['deepl','free'],['deepl','pro'],['google','pro']] as const){const calls:{url:URL;body:any;headers:Headers}[]=[];
    await fixture(async(ai,directory)=>{
      const before=ai.state(),profile=ai.translators.save(input(provider,plan)),result=await ai.translateBatch(reference(ai,profile.id),10,[{id:'a',text:'first'},{id:'b',text:'second'}],'zh-Hant');
      assert.deepEqual(profile.capabilities,{batch:true,detectLanguage:true,glossary:false,images:false,quota:'unknown'});
      assert.deepEqual(result.paragraphs.map(p=>p.id),['a','b']);assert.equal(result.paragraphs[0].text,provider==='google'?"甲 & <tag> ' 😀":'甲');assert.equal(result.paragraphs[0].sourceLanguage,'en');
      assert.equal(provider==='azure'?result.model===undefined:result.model=== (provider==='deepl'?'quality_optimized':'nmt'),true);
      assert.deepEqual(ai.state(),before);assert.equal(JSON.stringify(ai.translators.list()).includes(secret),false);assert.equal(JSON.stringify(ai.translators.list()).includes('encrypted'),false);assert.equal((await readFile(join(directory,'ai-data.json'),'utf8')).includes(secret),false);
      assert.equal(calls[0].url.origin+calls[0].url.pathname,translationServiceEndpoint(provider,plan));assert.equal(calls[0].url.search.includes(secret),false);
      if(provider==='azure'){assert.equal(calls[0].headers.get('Ocp-Apim-Subscription-Key'),secret);assert.equal(calls[0].headers.get('Ocp-Apim-Subscription-Region'),'eastasia');assert.equal(calls[0].url.searchParams.get('to'),'zh-Hant');assert.deepEqual(calls[0].body,[{Text:'first'},{Text:'second'}]);}
      else if(provider==='deepl'){assert.equal(calls[0].headers.get('authorization'),'DeepL-Auth-Key '+secret);assert.equal(calls[0].body.target_lang,'ZH-HANT');assert.deepEqual(calls[0].body.text,['first','second']);}
      else{assert.equal(calls[0].headers.get('x-goog-api-key'),secret);assert.equal(calls[0].body.target,'zh-TW');assert.equal(calls[0].body.format,'text');assert.deepEqual(calls[0].body.q,['first','second']);}
    },async(url,init)=>{assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');calls.push({url:new URL(String(url)),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});return response(provider==='azure'?[{detectedLanguage:{language:'en'},translations:[{to:'zh-Hant',text:'甲'}]},{translations:[{to:'zh-Hant',text:'乙'}]}]:provider==='deepl'?{translations:[{text:'甲',detected_source_language:'EN',model_type_used:'quality_optimized'},{text:'乙',model_type_used:'quality_optimized'}]}:{data:{translations:[{translatedText:'甲 &amp; &lt;tag&gt; &#39; &#x1F600;',detectedSourceLanguage:'en',model:'nmt'},{translatedText:'乙',model:'nmt'}]}});});
  }
});
test('registry edit/delete revisions protect concurrent changes, endpoint changes require new key, and persistence failure rolls back',()=>fixture(async(ai,directory)=>{
  const first=ai.translators.save(input()),changed=ai.translators.save({...input(),id:first.id,revision:first.revision,name:'Edited',apiKey:undefined});assert.notEqual(changed.revision,first.revision);assert.equal(ai.translators.connection(reference(ai,first.id)).key,secret);
  assert.throws(()=>ai.translators.save({...input(),id:first.id,revision:first.revision}),/已改变/);assert.throws(()=>ai.translators.remove(first.id,first.revision),/已改变/);
  assert.throws(()=>ai.translators.save({...input('google'),id:first.id,revision:changed.revision,apiKey:undefined}),/重新填写/);assert.equal(ai.translators.list()[0].provider,'azure');
  const before=await readFile(join(directory,'ai-data.json'),'utf8');await mkdir(join(directory,'ai-data.json.tmp'));try{assert.throws(()=>ai.translators.save(input('deepl','free')));assert.equal(ai.translators.list().length,1);assert.equal(await readFile(join(directory,'ai-data.json'),'utf8'),before);}finally{await rmdir(join(directory,'ai-data.json.tmp'));}
  ai.translators.remove(changed.id,changed.revision);assert.deepEqual(ai.translators.list(),[]);
}));
test('registry validation, corrupt records and crypto failure never overwrite credentials or expose plaintext',()=>{
  for(const value of [{...input(),endpoint:'https://untrusted.example'}, {...input(),apiKey:'x\nHeader'}, {...input(),provider:'__proto__'}, {...input(),timeoutSeconds:0}])assert.throws(()=>translationServiceInput(value));
  let stored:unknown=undefined;const registry=new TranslationServices(()=>stored,value=>stored=value),profile=registry.save(input());const before=JSON.stringify(stored),encrypt=serviceCredentialCrypto.encrypt;
  try{serviceCredentialCrypto.encrypt=()=>{throw Error('private message');};assert.throws(()=>registry.save({...input(),id:profile.id,revision:profile.revision}),/^Error: 翻译密钥无法加密$/);assert.equal(JSON.stringify(stored),before);}finally{serviceCredentialCrypto.encrypt=encrypt;}
  stored=[{...(stored as any[])[0],apiKey:secret}];assert.throws(()=>registry.list(),/无法读取/);assert.equal(JSON.stringify(stored).includes(secret),true);
});
test('Azure legacy migration deduplicates, switches only on save and restores encrypted old connection across reopen',()=>fixture(async(ai)=>{
  const store=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai),legacy=await store.save({revision:(await store.state()).revision,provider:'azure',endpoint:'',model:'',region:'eastasia',key:secret}),ref=await store.migrateLegacy(legacy.revision);assert.ok('serviceId' in ref);
  assert.deepEqual(await store.migrateLegacy(legacy.revision),ref);assert.equal(ai.translators.list().length,1);assert.equal((await store.connection(legacy.revision)).provider,'azure');
  const saved=await store.save({revision:legacy.revision,provider:'service',endpoint:'',model:'',region:'',serviceReference:ref as TranslationServiceReference});assert.equal(saved.ready,true);assert.equal(saved.canRestoreLegacy,true);assert.equal((await store.connection(saved.revision)).key,'');assert.throws(()=>formulaSettings({...saved}),/公式/);
  const reopened=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai);assert.equal((await reopened.state()).revision,saved.revision);const restored=await reopened.restoreLegacy(saved.revision);assert.equal((await reopened.connection(restored.revision)).key,secret);assert.equal(restored.region,'eastasia');
}));
test('dedicated responses isolate malformed texts but reject ambiguous counts and redact provider error bodies',async()=>{
  let mode='partial';await fixture(async(ai)=>{const profile=ai.translators.save(input('google')),ref=reference(ai,profile.id),paragraphs=[{id:'a',text:'first'},{id:'b',text:'second'}];
    const partial=await ai.translateBatch(ref,10,paragraphs,'en');assert.equal(partial.paragraphs[0].text,'valid');assert.match(partial.paragraphs[1].error!,/段落/);
    mode='count';await assert.rejects(ai.translateBatch(ref,10,paragraphs,'en'),/数量不匹配/);mode='quota';await assert.rejects(ai.translateBatch(ref,10,paragraphs,'en'),/^Error: 翻译服务额度已用完$/);
    mode='malformed';await assert.rejects(ai.translateBatch(ref,10,paragraphs,'en'),/格式无效/);
  },async()=>mode==='partial'?response({data:{translations:[{translatedText:'valid'},{translatedText:0}]}}):mode==='count'?response({data:{translations:[{translatedText:'one'}]}}):mode==='quota'?new Response(secret,{status:456}):new Response(secret));
});
test('provider bounds reject duplicate IDs and images before requests; declared and streaming capacity failures cancel bodies',async()=>{
  let calls=0,cancelled=0,declared=true;await fixture(async(ai)=>{const p=ai.translators.save(input('google')),ref=reference(ai,p.id);
    for(const paragraphs of [[{id:'a',text:'x'.repeat(5001)}],[{id:'a',text:'one',image:'untrusted'}],[{id:'a',text:'a'},{id:'a',text:'b'}]])await assert.rejects(ai.translateBatch(ref,10,paragraphs as any,'en'));assert.equal(calls,0);
    await assert.rejects(ai.translateBatch(ref,10,[{id:'a',text:'one'}],'en'),/容量/);assert.equal(cancelled,1);declared=false;await assert.rejects(ai.translateBatch(ref,10,[{id:'a',text:'one'}],'en'),/容量/);assert.equal(cancelled,2);
  },async()=>{calls++;return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024+1));},cancel(){cancelled++;}}),{headers:declared?{'content-length':String(1024*1024+1)}:undefined});});
});
test('service edits invalidate references and late results; binding revision follows the registry without returning keys',async()=>{
  let started=false,finish!:(value:Response)=>void;await fixture(async(ai)=>{const profile=ai.translators.save(input()),ref=reference(ai,profile.id),store=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai),saved=await store.save({revision:(await store.state()).revision,provider:'service',endpoint:'',model:'',region:'',serviceReference:ref});
    const pending=ai.translateBatch(ref,10,[{id:'a',text:'one'}],'en');void pending.catch(()=>{});await until(()=>started);ai.translators.save({...input(),id:profile.id,revision:profile.revision,name:'Changed'});finish(response([{translations:[{to:'en',text:'one'}]}]));await assert.rejects(pending,/配置已改变/);
    const changed=await store.state();assert.notEqual(changed.revision,saved.revision);assert.equal(changed.ready,true);await assert.rejects(store.connection(saved.revision),/已改变/);assert.equal((await store.connection(changed.revision)).key,'');
    const current=ai.translators.list()[0];ai.translators.remove(current.id,current.revision);assert.equal((await store.state()).ready,false);
  },async()=>{started=true;return new Promise<Response>(resolve=>finish=resolve);});
});
test('dedicated requests share AI three-task capacity and owner cancellation closes pending response readers',async()=>{
  let calls=0,cancelled=0;const transport:typeof fetch=async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});};
  await fixture(async(ai)=>{
    await ai.profile({name:'AI fixture',kind:'openai',baseUrl:'https://ai.example/v1',model:'m',models:[{id:'m',name:'m'}],maxTokens:256,timeoutSeconds:5,temperature:0,tokenField:'max_tokens',apiKey:secret});const task=ai.taskProfiles()[0],aiRef={profileId:task.id,model:'m',revision:task.revision};
    const profile=ai.translators.save(input()),ref=reference(ai,profile.id),pending=[ai.translateBatch(ref,1,[{id:'a',text:'one'}],'en'),ai.runTask({owner:2,reference:aiRef,purpose:'translation',target:'en',paragraphs:[{id:'a',text:'one'}]}),ai.translateBatch(ref,3,[{id:'a',text:'one'}],'en')];pending.forEach(p=>void p.catch(()=>{}));await until(()=>calls===3);
    await assert.rejects(ai.translateBatch(ref,4,[{id:'a',text:'one'}],'en'),/太多/);await assert.rejects(ai.runTask({owner:4,reference:aiRef,purpose:'translation',target:'en',paragraphs:[{id:'a',text:'one'}]}),/太多/);ai.cancelTaskOwner(2);await assert.rejects(pending[1],/取消/);assert.equal(cancelled,1);ai.cancelTaskOwner(1);ai.cancelTaskOwner(3);await Promise.allSettled(pending);assert.equal(cancelled,3);
  },transport,transport);
});
test('shared TranslationClient batches and retries only bad dedicated paragraphs with detected-language provenance',()=>fixture(async(ai)=>{
  const profile=ai.translators.save(input('google')),store=new RecognitionConnectionStore(ai.serviceConnections(),serviceCredentialCrypto,'translation',ai),saved=await store.save({revision:(await store.state()).revision,provider:'service',endpoint:'',model:'',region:'',serviceReference:reference(ai,profile.id)}),connection=await store.connection(saved.revision),client=new TranslationClient(undefined,undefined,new RecognitionTaskProvider(ai,()=>70));
  const partial=await client.run(connection,'first\nsecond','en');assert.equal(partial.parts![0].text,'FIRST');assert.equal(partial.parts![0].sourceLanguage,'en');assert.equal(partial.parts![1].status,'failed');
  const fixed=await client.retry(connection,partial.id,['p2']);assert.equal(fixed.text,'FIRST\nSECOND');assert.equal(fixed.parts![0].text,partial.parts![0].text);
},async(_url,init)=>{const body=JSON.parse(String(init?.body));return response({data:{translations:body.q.map((q:string,index:number)=>({translatedText:body.q.length>1&&index===1?0:q.toUpperCase(),detectedSourceLanguage:'en'}))}});}));
