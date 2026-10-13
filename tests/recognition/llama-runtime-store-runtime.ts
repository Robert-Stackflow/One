import assert from 'node:assert/strict';
import { open, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LlamaRuntimeStore } from '../../src/main/recognition/llama-runtime-store';
import { llamaRuntimeProfiles } from '../../src/main/recognition/llama-runtime-catalog';
import type { LocalModelStore } from '../../src/main/local-model-store';
const directory=process.env.ONE_MODEL_TEST_ROOT!,fixtures=resolve('work/current/capture-reconstruction/deepseek'),root=join(directory,'cache');
let network=0;const store=new LlamaRuntimeStore(root,async()=>{network++;throw Error('native runtime verification must stay offline');});
const sources=(backend:'cpu'|'cuda')=>Object.fromEntries(llamaRuntimeProfiles.find(profile=>profile.backend===backend)!.archives.map(archive=>[archive.id,join(fixtures,archive.name)]));
try{
  const firstAbort=new AbortController(),secondAbort=new AbortController();
  const first=store.install('cpu',firstAbort.signal,progress=>{progress.received=Number.MAX_SAFE_INTEGER;if(progress.artifact?.endsWith('.dll'))firstAbort.abort();},sources('cpu')).then(()=>false,error=>/取消/.test(String(error)));
  const second=store.install('cpu',secondAbort.signal,progress=>assert.ok(progress.received<=progress.total),sources('cpu'));
  assert.equal(await first,true);await second;assert.equal((await store.state('cpu',true)).ready,true);
  for(const backend of ['cpu','cuda'] as const){
    await store.install(backend,new AbortController().signal,()=>{},sources(backend));const lease=await store.acquire(backend);
    try{
      const version=await promisify(execFile)(lease.executable,['--version'],{windowsHide:true,maxBuffer:65536,timeout:15000});assert.match(version.stdout+version.stderr,/11588/);
      const devices=await promisify(execFile)(lease.executable,['--list-devices'],{windowsHide:true,maxBuffer:65536,timeout:15000});
      if(backend==='cuda')assert.match(devices.stdout+devices.stderr,/CUDA0.*NVIDIA/);else assert.doesNotMatch(devices.stdout,/CUDA\d/);
      await assert.rejects(store.remove(backend),/使用/);
    }finally{lease.release();}
  }
  const lease=await store.acquire('cpu'),dll=join(lease.directory,'ggml-base.dll');lease.release();
  const handle=await open(dll,'r+');const original=Buffer.alloc(1);await handle.read(original,0,1,0);await handle.write(Buffer.from([original[0]^0xff]),0,1,0);await handle.close();
  await assert.rejects(store.acquire('cpu'),/校验/);await store.install('cpu',new AbortController().signal,()=>{},sources('cpu'));
  assert.equal((await store.state('cpu',true)).ready,true);await store.remove('cpu');
  const cancel=new AbortController();await assert.rejects(store.install('cpu',cancel.signal,progress=>{if(progress.artifact?.endsWith('.dll'))cancel.abort();},sources('cpu')),/取消/);
  await store.install('cpu',new AbortController().signal,()=>{},sources('cpu'));assert.equal((await store.state('cpu',true)).ready,true);
  assert.ok(!(await readdir(join(root,'binaries'))).some(name=>name.startsWith('.extract-')));assert.equal(network,0);
  const binaries=(store as unknown as {binaries:LocalModelStore}).binaries,acquire=binaries.acquire.bind(binaries);
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),began=new Promise<void>(resolve=>entered=resolve);
  binaries.acquire=async input=>{const lease=await acquire(input);entered();await gate;return lease;};
  const pending=store.acquire('cpu');void pending.catch(()=>{});await began;await store.stop();release();await assert.rejects(pending,/关闭/);
  assert.equal((await store.state('cpu')).inUse,false);await assert.rejects(store.install('cpu',new AbortController().signal),/关闭/);await assert.rejects(store.remove('cpu'),/关闭/);
  console.log('native runtime cache: CPU/CUDA verified packages, offline reuse, shared cancellation, leases, corrupt DLL rejection/repair and retry cleanup passed');
}finally{await store.stop();}
