import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {TranslationClient} from '../../src/main/recognition/translation-client';
import {translationParts,translationBatches,assembleTranslation} from '../../src/shared/recognition/translation-document';
import {translationDocumentText,TRANSLATION_DOCUMENT_OUTPUT,type TranslationConnection,type TranslationResult} from '../../src/shared/recognition/translation';
import {taskTranslation,type AITaskParagraph} from '../../src/shared/ai-task';
import {OCRWorkflow} from '../../src/main/recognition/ocr-workflow';
const connection=():TranslationConnection=>({provider:'ai',reference:{profileId:'profile',model:'fixture',revision:'a'.repeat(64)},revision:randomUUID(),endpoint:'',region:'',model:'fixture',key:''});
function client(budget:number,send:(paragraphs:AITaskParagraph[],signal:AbortSignal)=>Promise<{paragraphs:({id:string;text:string}|{id:string;error:string})[];model:string}>){
  return new TranslationClient(async()=>{throw Error('Legacy transport called');},1000,{translate:async()=>{throw Error('Old AI path called');},translationBudget:()=>budget,translateBatch:async(_connection,paragraphs,_target,signal)=>send(paragraphs,signal)});
}
const echo=async(paragraphs:AITaskParagraph[])=>({paragraphs:paragraphs.map(p=>({id:p.id,text:p.text.toUpperCase()})),model:'actual-model'});
async function until(check:()=>boolean){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('Fixture not started');await new Promise(resolve=>setTimeout(resolve,5));}}
test('paragraph ranges preserve indentation/blank lines/CRLF, word breaks and Unicode without empty sends',()=>{
  const source='  first\r\n\r\n\t'+'😀'.repeat(30)+'    \nlast  ',parts=translationParts(source,32);assert.deepEqual(parts.map(p=>p.paragraph),[1,2,2,3]);
  for(const part of parts){const text=source.slice(part.start,part.end);assert.ok(text.trim());assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text));assert.ok(text.length<=32);part.status='translated';part.text=text;}
  assert.equal(assembleTranslation({source,text:'',revision:'r',target:'en',endpoint:'',parts}).text,source);
  const spaced='a'+' '.repeat(120)+'b';assert.ok(translationParts(spaced,32).every(p=>spaced.slice(p.start,p.end).trim()));
  assert.throws(()=>translationParts(Array(2049).fill('x').join('\n'),32),/段落过多/);assert.throws(()=>translationDocumentText('x'.repeat(200001)),/200,000/);assert.throws(()=>translationDocumentText('x\0y'));
});
test('long documents batch by profile output budget and 32 IDs, preserve all text and expose cloned snapshots',async()=>{
  const source=Array(50).fill('line').join('\n')+'\n'+'x'.repeat(21000),requests:AITaskParagraph[][]=[],c=client(1024,async paragraphs=>{requests.push(paragraphs);return echo(paragraphs);}),result=await c.run(connection(),source,'en');
  assert.equal(result.text,source.toUpperCase());assert.ok(requests.length>20);assert.ok(requests.every(batch=>batch.length<=32&&batch.reduce((n,p)=>n+p.text.length,0)<=1024));assert.equal(result.parts!.filter(p=>p.status==='translated').length,result.parts!.length);assert.equal(result.model,'actual-model');
  const snapshot=c.snapshot()!;snapshot.parts![0].text='tampered';assert.notEqual(c.snapshot()!.parts![0].text,'tampered');
  c.clearSnapshot();assert.equal(c.snapshot(),undefined);
  assert.throws(()=>translationBatches(translationParts('x'.repeat(16417),32),32),/过多翻译批次/);
});
test('missing/duplicate/malformed IDs keep valid out-of-order paragraphs, and retry sends only failed source IDs',async()=>{
  let calls=0;const requests:AITaskParagraph[][]=[],c=client(1024,async paragraphs=>{requests.push(paragraphs);calls++;
    const raw=calls===1?[{id:'p4',text:5},{id:'p3',text:'THREE'},{id:'source',text:'ONE'},{id:'p2',text:'two'},{id:'p2',text:'duplicate'},{id:'extra',text:'ignore'}]:paragraphs.map(p=>({id:p.id,text:p.text.toUpperCase()}));
    return {paragraphs:taskTranslation(JSON.stringify({paragraphs:raw}),paragraphs).paragraphs,model:'actual-model'};
  }),ref=connection(),result=await c.run(ref,'one\ntwo\nthree\nfour\nfive','en');
  assert.equal(result.text,'ONE\n\nTHREE\n\n');assert.deepEqual(result.parts!.filter(p=>p.status==='translated').map(p=>p.id),['source','p3']);assert.match(result.parts![1].error!,/重复/);assert.match(result.parts![3].error!,/无效/);assert.match(result.parts![4].error!,/未返回/);
  const fixed=await c.retry(ref,result.id,['p2','p4','p5']);assert.equal(fixed.text,'ONE\nTWO\nTHREE\nFOUR\nFIVE');assert.deepEqual(requests[1].map(p=>p.id),['p2','p4','p5']);assert.equal(fixed.parts![0].text,result.parts![0].text);assert.equal(fixed.parts![2].text,result.parts![2].text);
  assert.throws(()=>c.retry(ref,result.id,['source']),/已经翻译完成/);assert.throws(()=>c.retry(ref,'old-job',['p2']),/已改变/);assert.throws(()=>c.retry({...ref,revision:randomUUID()},result.id,['p2']),/已改变/);
});
test('protocol failures can leave later batches intact while a service outage stops unsent batches',async()=>{
  let calls=0;const c=client(32,async p=>{calls++;if(calls===1)throw Error('翻译服务未返回有效的段落 JSON');return echo(p);}),ref=connection(),source='x'.repeat(33)+'\n'+'y'.repeat(33),result=await c.run(ref,source,'en');
  assert.equal(result.parts![0].status,'failed');assert.ok(result.parts!.slice(1).every(p=>p.status==='translated'));assert.ok(calls>1);
  calls=0;const outage=client(32,async()=>{calls++;throw Error('AI 请求超时');}),failed=await outage.run(ref,source,'en');assert.equal(calls,1);assert.ok(failed.parts!.slice(1).every(p=>p.error?.startsWith('尚未发送：')));
});
test('cancel preserves completed batches, marks unsent IDs, and manual retry resumes without resending successes',async()=>{
  let calls=0,waiting=false;const sent:string[][]=[],c=client(64,async(p,signal)=>{calls++;sent.push(p.map(p=>p.id));if(calls===2){waiting=true;await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}return echo(p);}),ref=connection();
  const pending=c.run(ref,'first\n'+'x'.repeat(180),'en');void pending.catch(()=>{});await until(()=>waiting);await c.cancel();await assert.rejects(pending);const partial=c.snapshot()!;assert.equal(partial.parts![0].status,'translated');assert.ok(partial.parts!.slice(1).every(p=>p.status==='cancelled'));assert.match(partial.text,/^FIRST\n/);
  const fixed=await c.retry(ref,partial.id,partial.parts!.slice(1).map(p=>p.id));assert.equal(fixed.text,'FIRST\n'+'X'.repeat(180));assert.ok(sent.slice(2).every(ids=>!ids.includes('source')));
});
test('legacy exact endpoints keep single short request and split long input into bounded recoverable parts',async()=>{
  const sends:string[]=[];const c=new TranslationClient(async(_url,init)=>{const body=JSON.parse(String(init?.body)),source=body.messages[1].content;sends.push(source);return new Response(JSON.stringify({choices:[{message:{content:source.toUpperCase()}}]}),{headers:{'content-type':'application/json'}});});
  const ref={...connection(),provider:'chat' as const,endpoint:'https://legacy.example/custom',key:'fixture'},short=await c.run(ref,'a\nb','en');assert.deepEqual(sends,['a\nb']);assert.equal(short.text,'A\nB');assert.equal(short.parts,undefined);
  sends.length=0;const source='x'.repeat(20001)+'\nlast',long=await c.run(ref,source,'en');assert.equal(long.text,source.toUpperCase());assert.ok(sends.every(text=>text.length<=20000));assert.equal(sends.length,3);
});
test('legacy long-document timeout retains precise failure and never reports user cancellation',async()=>{
  const c=new TranslationClient(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true})),20),ref={...connection(),provider:'chat' as const,endpoint:'https://legacy.example/custom',key:'fixture'},keepAlive=setInterval(()=>{},1000);
  try{await assert.rejects(c.run(ref,'x'.repeat(20001),'en'),/超时/);const result=c.snapshot()!;assert.ok(result.parts!.every(part=>part.status==='failed'&&part.error?.includes('超时')));}finally{clearInterval(keepAlive);}
});
test('output capacity failure is isolated to excess parts and partial workflows cannot report success',async()=>{
  const c=client(12000,async p=>({paragraphs:p.map(part=>({id:part.id,text:'T'.repeat(40000)})),model:'actual'})),result=await c.run(connection(),Array(17).fill('a').join('\n'),'en');assert.ok(result.text.length<=TRANSLATION_DOCUMENT_OUTPUT);assert.ok(result.parts!.some(part=>part.status==='failed'));
  const translation:TranslationResult={source:'source',text:'GOOD\n',revision:'r',target:'en',endpoint:'',parts:[{id:'p',start:0,end:6,paragraph:1,chunk:1,status:'failed',error:'missing'}]};
  const workflow=new OCRWorkflow({prepare:async()=> 'token',valid:()=>true,config:async()=>({revision:'r',provider:'chat',endpoint:'',model:'',region:'',keySaved:true,ready:true,error:''}),recognize:async()=>({text:'source',words:[],confidence:90,width:1,height:1,language:'eng'}),translate:async()=>translation,cancel:async()=>{}});
  await assert.rejects(workflow.run('owner',Buffer.alloc(1),'en'),/部分段落/);assert.equal(workflow.state!.status,'failed');assert.equal(workflow.read('token',workflow.state!.id).translation!.text,'GOOD\n');
  workflow.acceptTranslation({...translation,text:'DONE',parts:translation.parts!.map(p=>({...p,status:'translated',text:'DONE'}))});assert.equal(workflow.state!.status,'done');assert.equal(workflow.read('token',workflow.state!.id).translation!.text,'DONE');
});
