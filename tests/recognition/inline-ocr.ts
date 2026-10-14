import test from 'node:test';
import assert from 'node:assert/strict';
import { InlineOCRSessions, type InlineEngine } from '../../src/main/recognition/inline-ocr';
import type { OCRResult } from '../../src/shared/recognition/ocr';
const header=()=>{const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(100,16);png.writeUInt32BE(80,20);return png.toString('base64');};
test('inline owners freeze input, isolate cancellation and discard replaced sessions',async()=>{
  const engines:{closed:boolean;input?:Buffer;resolve?:(result:OCRResult)=>void;unloads:(string|undefined)[]}[]=[];
  const sessions=new InlineOCRSessions(()=>{
    const state={closed:false,input:undefined as Buffer|undefined,resolve:undefined as ((result:OCRResult)=>void)|undefined,unloads:[] as (string|undefined)[]};engines.push(state);
    return {run:async(png,size,language,signal)=>{state.input=png;return new Promise<OCRResult>((resolve,reject)=>{state.resolve=resolve;signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});},
      cancel:async()=>{},close:async()=>{state.closed=true;},unload:async id=>{state.unloads.push(id);}} satisfies InlineEngine;
  },async()=>{throw Error('No implicit network');});
  try{
    const a=await sessions.prepare(1,'editor-a',header()),b=await sessions.prepare(2,'preview-b',header());
    assert.throws(()=>sessions.source(2,a.id),/失效/);assert.throws(()=>sessions.source(1,b.id),/失效/);
    const first=sessions.run(1,a.id,'eng'),second=sessions.run(2,b.id,'eng');void first.catch(()=>{});void second.catch(()=>{});await Promise.resolve();
    assert.throws(()=>sessions.run(1,a.id,'eng'),/当前识别/);await sessions.unload('native-model');assert.ok(engines.every(engine=>!engine.unloads.length));
    await sessions.cancel(1,a.id);await assert.rejects(first);await sessions.unload('native-model');assert.deepEqual(engines[0].unloads,['native-model']);assert.deepEqual(engines[1].unloads,[]);
    assert.ok(engines[1].input?.some(value=>value!==0));assert.equal(engines[1].closed,false);
    engines[1].resolve!({text:'B',language:'eng',width:100,height:80,confidence:90,words:[]});assert.equal((await second).text,'B');
    const replacement=await sessions.prepare(1,'editor-new',header());assert.notEqual(replacement.id,a.id);assert.equal(engines[0].closed,true);assert.ok(engines[0].input?.every(value=>value===0));
    assert.throws(()=>sessions.copy(1,a.id,'old'),/失效/);assert.equal(sessions.copy(1,replacement.id,'new'),'new');
    await sessions.releaseOwner(1,a.id);assert.equal(sessions.source(1,replacement.id),'editor-new');
    await sessions.stop();assert.ok(engines.every(engine=>engine.closed));assert.ok(engines[1].input?.every(value=>value===0));
    await assert.rejects(sessions.prepare(3,'late',header()),/准备/);
  }finally{await sessions.stop();}
});
test('cancel before a queued recognition starts never dispatches the engine',async()=>{
  let calls=0;const sessions=new InlineOCRSessions(()=>({run:async()=>{calls++;throw Error('Unexpected');},cancel:async()=>{},close:async()=>{}}),async()=>{throw Error('Unexpected');});
  const state=await sessions.prepare(1,'source',header());const task=sessions.run(1,state.id,'eng');void task.catch(()=>{});
  await sessions.cancel(1,state.id);await assert.rejects(task);assert.equal(calls,0);await sessions.stop();
});
test('shutdown waits for sessions already removed from the owner map',async()=>{
  let finish!:()=>void;const cleanup=new Promise<void>(resolve=>{finish=resolve;});
  const sessions=new InlineOCRSessions(()=>({run:async()=>{throw Error('Unexpected');},cancel:async()=>{},close:()=>cleanup}),async()=>{throw Error('Unexpected');});
  await sessions.prepare(1,'source',header());const release=sessions.releaseOwner(1);let stopped=false;
  const stopping=sessions.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
  finish();await Promise.all([release,stopping]);assert.equal(stopped,true);
});
test('unconfirmed native cleanup remains an error at shutdown',async()=>{
  const sessions=new InlineOCRSessions(()=>({run:async()=>{throw Error('Unexpected');},cancel:async()=>{},close:async()=>{throw Error('cleanup unconfirmed');}}),async()=>{throw Error('Unexpected');});
  await sessions.prepare(1,'source',header());await assert.rejects(sessions.releaseOwner(1),/cleanup unconfirmed/);await assert.rejects(sessions.stop(),/cleanup unconfirmed/);
});
