import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rmdir,realpath,rm} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {OneAIService} from '../../src/main/ai-service';
import {RecognitionConnectionStore} from '../../src/main/recognition/connections';
import {serviceCredentialCrypto} from '../../src/main/service-connections';

const config={provider:'chat',endpoint:'https://translate.example/v2/custom/completions',model:'translation-fixture',region:'',key:'fixture-key-never-render'};
async function fixture(run:(directory:string)=>Promise<void>){
  const root=resolve(process.env.ONE_RECOGNITION_TEST_ROOT!),directory=await mkdtemp(join(root,'connections-'));
  try{await run(directory);}finally{const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));assert.ok(basename(actual).startsWith('connections-'));await rm(actual,{recursive:true,force:true});}
}

test('One stores encrypted feature connections beside AI credentials without exposing them or creating chat history',()=>fixture(async directory=>{
  await writeFile(join(directory,'ai-data.json'),JSON.stringify({profiles:[],conversations:[],history:[],keys:{existing:'existing-encrypted-key'}}));
  const ai=new OneAIService(directory,()=>{}),storage=ai.serviceConnections(),store=new RecognitionConnectionStore(storage,serviceCredentialCrypto);
  const before=ai.state(),blank=await store.state(),saved=await store.save({...config,revision:blank.revision});
  assert.equal(saved.ready,true);assert.equal(saved.endpoint,config.endpoint);
  const raw=await readFile(join(directory,'ai-data.json'),'utf8'),record=JSON.parse(raw);
  assert.equal(raw.includes(config.key),false);assert.equal(record.connections.translation.format,'one-recognition-connection');
  assert.equal(record.connections.translation.purpose,'translation');assert.equal(record.connections.translation.version,1);
  assert.equal(record.keys.existing,'existing-encrypted-key');assert.deepEqual(ai.state(),before);
  assert.equal(JSON.stringify(saved).includes('encrypted'),false);assert.equal(JSON.stringify(ai.state()).includes('connections'),false);
  const reopened=new OneAIService(directory,()=>{}),fresh=new RecognitionConnectionStore(reopened.serviceConnections(),serviceCredentialCrypto);
  assert.equal((await fresh.connection(saved.revision)).key,config.key);
  const copied=await storage.read('translation') as any;copied.endpoint='https://unwanted.example';
  assert.equal((await storage.read('translation') as any).endpoint,config.endpoint);
  await assert.rejects(storage.read('__proto__' as any),/类型无效/);
}));

test('feature revisions, endpoint changes, Azure settings and formula credentials remain independent',()=>fixture(async directory=>{
  const ai=new OneAIService(directory,()=>{}),storage=ai.serviceConnections(),translation=new RecognitionConnectionStore(storage,serviceCredentialCrypto),formula=new RecognitionConnectionStore(storage,serviceCredentialCrypto,'formula');
  const saved=await translation.save({...config,revision:(await translation.state()).revision});
  const vision=await formula.save({...config,key:'vision-fixture-secret',revision:(await formula.state()).revision});
  await assert.rejects(translation.save({...config,key:undefined,endpoint:'https://other.example/complete',revision:saved.revision}),/重新填写/);
  const changed=await translation.save({...config,key:undefined,model:'other-model',revision:saved.revision});
  assert.equal((await translation.connection(changed.revision)).key,config.key);
  await assert.rejects(translation.connection(saved.revision),/改变/);await assert.rejects(translation.clear(saved.revision),/改变/);
  const azure=await translation.save({...config,provider:'azure',region:'eastasia',revision:changed.revision});
  assert.equal(azure.provider,'azure');assert.equal(azure.endpoint,'https://api.cognitive.microsofttranslator.com/translate');
  const results=await Promise.allSettled([translation.save({...config,revision:azure.revision}),translation.save({...config,revision:azure.revision})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
  await translation.clear((await translation.state()).revision);assert.equal((await translation.state()).ready,false);
  assert.equal((await formula.connection(vision.revision)).key,'vision-fixture-secret');
  await assert.rejects(formula.save({...config,provider:'azure',revision:vision.revision}),/公式/);
  await formula.clear(vision.revision);assert.deepEqual(JSON.parse(await readFile(join(directory,'ai-data.json'),'utf8')).connections,{});
}));

test('failed One persistence rolls back connection state and preserves the previously usable credential',()=>fixture(async directory=>{
  const ai=new OneAIService(directory,()=>{}),storage=ai.serviceConnections(),store=new RecognitionConnectionStore(storage,serviceCredentialCrypto),saved=await store.save({...config,revision:(await store.state()).revision});
  const before=await readFile(join(directory,'ai-data.json'),'utf8');
  await mkdir(join(directory,'ai-data.json.tmp'));
  await assert.rejects(store.save({...config,key:'replacement-secret',revision:saved.revision}));
  await assert.rejects(store.clear(saved.revision));
  assert.deepEqual(await store.state(),saved);assert.equal((await store.connection(saved.revision)).key,config.key);
  assert.equal(await readFile(join(directory,'ai-data.json'),'utf8'),before);
  assert.equal((await storage.read('translation') as any).revision,saved.revision);
  await rmdir(join(directory,'ai-data.json.tmp'));
  await store.clear(saved.revision);await store.settle();assert.equal((await store.state()).ready,false);
}));

test('corrupt, cross-purpose or legacy records and unavailable encryption fail without disclosing private values',()=>fixture(async directory=>{
  const storage=new OneAIService(directory,()=>{}).serviceConnections();
  for(const record of ['malformed private text',[],null,{format:'frame-translation',version:1,encrypted:'private'},{format:'one-recognition-connection',version:1,purpose:'formula',encrypted:'private'}]){
    await storage.write('translation',record);
    const state=await new RecognitionConnectionStore(storage,serviceCredentialCrypto).state();assert.equal(state.ready,false);assert.match(state.error,/无法读取/);assert.equal(state.error.includes('private'),false);
  }
  await storage.clear('translation');
  const unavailable={...serviceCredentialCrypto,available:()=>false};
  const store=new RecognitionConnectionStore(storage,unavailable);
  await assert.rejects(store.save({...config,revision:(await store.state()).revision}),/系统加密/);
  const broken=new RecognitionConnectionStore(storage,{...serviceCredentialCrypto,encrypt:()=>{throw Error('private-key');}});
  await assert.rejects(broken.save({...config,revision:(await broken.state()).revision}),/^Error: 翻译密钥无法加密$/);
  const path=join(directory,'ai-data.json'),data=JSON.parse(await readFile(path,'utf8'));
  data.connections='corrupt private record';await writeFile(path,JSON.stringify(data));
  const recovering=new RecognitionConnectionStore(new OneAIService(directory,()=>{}).serviceConnections(),serviceCredentialCrypto),invalid=await recovering.state();
  assert.equal(invalid.ready,false);assert.match(invalid.error,/无法读取/);
  const repaired=await recovering.save({...config,revision:invalid.revision});assert.equal(repaired.ready,true);
  assert.equal((await recovering.connection(repaired.revision)).key,config.key);
}));
