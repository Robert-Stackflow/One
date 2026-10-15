import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, stat, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalModelStore, localModelIdentity } from '../src/main/local-model-store';
import { localModelCatalog,miganModel } from '../src/main/local-model-catalog';
import type { LocalModelDescriptor } from '../src/shared/local-models';
import {formulaPlusL} from '../src/main/recognition/formula-model-catalog';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';

test('official plus-L archive prefix matches the portion originally received from Hugging Face',{skip:process.env.ONE_MODEL_LIVE_PREFIX!=='1'},async()=>{
  const source=resolve('work/current/capture-reconstruction/formula/plus-l/inference.pdiparams'),weight=formulaPlusL.source.artifacts.find(file=>file.role==='weights')!,bytes=101711872,hash=createHash('sha256');
  assert.equal((await stat(source)).size,weight.bytes);for await(const chunk of createReadStream(source,{start:0,end:bytes-1}))hash.update(chunk);
  const model={id:'plus-l-prefix-proof',revision:formulaPlusL.source.revision,artifacts:[{...weight,name:'prefix.bin',bytes,sha256:hash.digest('hex')}]},directory=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'archive-prefix-'));
  const store=new LocalModelStore(directory);await store.install(model,new AbortController().signal);const lease=await store.acquire(model);
  try{assert.equal((await stat(lease.files[0].path)).size,bytes);}finally{lease.release();}
});

test('official Paddle archive resumes the last MiB and verifies the pinned full weight without retransferring it',{skip:process.env.ONE_MODEL_LIVE_FORMULA!=='1'},async()=>{
  const directory=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'live-slice-')),source=resolve('work/current/capture-reconstruction/formula/plus-l'),model=formulaPlusL.source,weight=model.artifacts.find(file=>file.role==='weights')!,range=weight.byteRange!,tail=1024**2;
  let live=false,networkBytes=0;const requests:string[]=[];
  const transport:typeof fetch=async(url,options)=>{
    assert.equal(String(url),weight.url);const header=new Headers(options?.headers).get('range')!;requests.push(header);
    if(live){const response=await fetch(url,options);networkBytes+=Number(response.headers.get('content-length'));return response;}
    const stream=Readable.toWeb(createReadStream(join(source,'inference.pdiparams'),{end:weight.bytes-tail-1}),{strategy:{highWaterMark:1024**2,size:chunk=>chunk.byteLength}});
    return new Response(stream as ReadableStream<Uint8Array>,{status:206,headers:{'content-range':`bytes ${range.offset}-${range.offset+weight.bytes-1}/${range.total}`,'content-length':String(weight.bytes)}});
  };
  const store=new LocalModelStore(directory,transport),sources={graph:join(source,'inference.json'),config:join(source,'config.json')};
  await assert.rejects(store.install(model,new AbortController().signal,undefined,sources),/中断/);
  live=true;await store.install(model,new AbortController().signal,undefined,sources);const lease=await store.acquire(model);
  try{assert.equal(networkBytes,tail);assert.equal((await stat(lease.files.find(file=>file.role==='weights')!.path)).size,weight.bytes);assert.deepEqual(requests,[`bytes=${range.offset}-${range.offset+weight.bytes-1}`,`bytes=${range.offset+weight.bytes-tail}-${range.offset+weight.bytes-1}`]);}
  finally{lease.release();}
});

test('archive slices resume logical artifact bytes and reject whole archives or wrong ranges without losing progress',async()=>{
  const root=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'slice-')),content=Buffer.from('fixed weight bytes'),offset=512,total=1024;
  const model:LocalModelDescriptor={id:'slice-fixture',revision:'1',title:'Slice',size:'S',purpose:'formula',languages:['en'],weightLicense:{name:'test',source:'https://fixture.invalid'},backends:['cpu'],precision:'fp32',runtime:'fixture',artifacts:[{name:'model.bin',role:'weights',url:'https://fixture.invalid/model.tar',bytes:content.length,sha256:createHash('sha256').update(content).digest('hex'),byteRange:{offset,total}}]};
  const requests:string[]=[],abort=new AbortController();let mode='partial',cancelled=0;
  const transport:typeof fetch=async(_url,options)=>{
    const range=new Headers(options?.headers).get('range')!;requests.push(range);const start=Number(/^bytes=(\d+)-/.exec(range)![1])-offset;
    const status=mode==='whole'?200:206,headers={'content-length':String(content.length-start),'content-range':`bytes ${offset+start+(mode==='wrong'?1:0)}-${offset+content.length-1}/${mode==='total'?total+1:total}`};
    return new Response(new ReadableStream({start(controller){if(mode==='partial')controller.enqueue(content.subarray(start,start+4));else controller.enqueue(content.subarray(start));if(mode==='partial')options?.signal?.addEventListener('abort',()=>controller.close(),{once:true});else controller.close();},cancel(){cancelled++;}}),{status,headers});
  };
  const store=new LocalModelStore(root,transport),key=localModelIdentity(model),partial=join(root,key+'.partial','model.bin.part');
  await assert.rejects(store.install(model,abort.signal,value=>{if(value.received>=4)abort.abort();}),/取消/);assert.equal((await readFile(partial)).length,4);
  for(mode of ['whole','wrong','total']){await assert.rejects(store.install(model,new AbortController().signal),/响应/);assert.equal((await readFile(partial)).length,4);}
  mode='normal';await store.install(model,new AbortController().signal);const lease=await store.acquire(model);assert.deepEqual(await readFile(lease.files[0].path),content);lease.release();
  assert.equal(requests[0],`bytes=${offset}-${offset+content.length-1}`);assert.ok(requests.slice(1).every(range=>range===`bytes=${offset+4}-${offset+content.length-1}`));assert.ok(cancelled>=3);
  const raw=structuredClone(model);delete raw.artifacts[0].byteRange;assert.notEqual(localModelIdentity(model),localModelIdentity(raw));
  for(const byteRange of [{offset:-1,total},{offset:1,total:2},{offset:1.5,total},{offset:0,total:17*1024**3}]){const invalid=structuredClone(model);invalid.artifacts[0].byteRange=byteRange;assert.throws(()=>localModelIdentity(invalid),/归档范围/);}
});

test('shared model bundles resume, publish atomically and preserve active/versioned models', async () => {
  const directory = await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!, 'cache-'));
  const content = Buffer.from('One deterministic model artifact\n'.repeat(8192));
  const config = Buffer.from('dictionary and preprocessing config');
  const requests: { name: string; range?: string }[] = [];
  let mode: 'normal' | 'stall' | 'bad-range' | 'ignore-range' | 'bad-hash' | 'config-fail' = 'normal';
  const server = createServer((request, response) => {
    const name = request.url!.slice(1), bytes = name === 'model.onnx' ? content : config;
    requests.push({ name, range: request.headers.range });
    if (mode === 'config-fail' && name === 'config.yml') { response.writeHead(503); response.end(); return; }
    const offset = mode === 'ignore-range' ? 0 : Number(/^bytes=(\d+)-$/.exec(request.headers.range || '')?.[1] || 0);
    const headers: Record<string, string | number> = { 'content-length': bytes.length - offset };
    if (offset) headers['content-range'] = `bytes ${mode === 'bad-range' ? offset + 1 : offset}-${bytes.length - 1}/${bytes.length}`;
    response.writeHead(offset ? 206 : 200, headers);
    if (mode === 'stall') response.write(bytes.subarray(offset, offset + 32));
    else response.end(mode === 'bad-hash' ? Buffer.alloc(bytes.length - offset, 0) : bytes.subarray(offset));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const transport: typeof fetch = (input, options) => fetch(String(input).replace('https://models.test', `http://127.0.0.1:${port}`), options);
  const descriptor: LocalModelDescriptor = { id: 'fixture', revision: 'v1', title: 'Fixture', size: 'tiny', purpose: 'ocr', languages: [],
    precision: 'fp32', runtime: 'test', backends: ['cpu'], weightLicense: { name: 'test', source: 'https://models.test' },
    artifacts: [['model.onnx', content], ['config.yml', config]].map(([name, bytes]) => ({ name: name as string, role: (name as string).split('.')[0],
      url: 'https://models.test/' + name, bytes: (bytes as Buffer).length, sha256: createHash('sha256').update(bytes as Buffer).digest('hex') })) };
  const store = new LocalModelStore(directory, transport, 100), signal = () => new AbortController().signal;
  try {
    assert.equal((await store.state(descriptor)).ready, false); assert.equal(requests.length, 0);
    // A completed first file is reusable, but cannot expose an incomplete bundle to inference.
    mode = 'config-fail';
    await assert.rejects(store.install(descriptor, signal()), /HTTP 503/);
    let state = await store.state(descriptor);
    assert.equal(state.ready, false); assert.equal(state.downloadedBytes, content.length);
    await assert.rejects(store.acquire(descriptor), /缺失|校验/);
    mode = 'normal'; const before = requests.length;
    const installed = await store.install(descriptor, signal());
    assert.equal(requests.length - before, 1); assert.equal(requests.at(-1)!.name, 'config.yml');
    state = await store.state(descriptor); assert.equal(state.ready, true); assert.equal(state.diskBytes, content.length + config.length);
    assert.deepEqual(await readFile(join(installed, 'model.onnx')), content);
    const offline = new LocalModelStore(directory, async () => { throw Error('network must not be called'); });
    await offline.install(descriptor, signal());
    const firstLease = await offline.acquire(descriptor), secondLease = await store.acquire(descriptor);
    const cancelledAcquire = new AbortController(); cancelledAcquire.abort(Error('cancelled hash verification'));
    await assert.rejects(store.acquire(descriptor, cancelledAcquire.signal), /cancelled hash verification/);
    await assert.rejects(store.remove(descriptor), /正在下载或使用/);
    firstLease.release(); firstLease.release(); await assert.rejects(store.remove(descriptor), /正在下载或使用/);
    const newer = structuredClone(descriptor); newer.revision = 'v2';
    const newerPath = await store.install(newer, signal()); assert.notEqual(newerPath, installed);
    await store.remove(newer); assert.equal((await store.state(descriptor)).ready, true);
    secondLease.release();
    assert.equal((await store.state(descriptor, undefined, false)).inUse, false, 'aborted verification releases its temporary lease');
    // Same-size corruption is never presented as ready; repair keeps the old bundle until replacement succeeds.
    await writeFile(join(installed, 'model.onnx'), Buffer.alloc(content.length, 0));
    assert.equal((await store.state(descriptor)).ready, false);
    await assert.rejects(store.acquire(descriptor), /校验/);
    assert.equal((await store.state(descriptor,undefined,false)).ready,false,'metadata reads retain a known integrity failure for repair');
    await store.install(descriptor, signal()); assert.equal((await store.state(descriptor)).ready, true);
    await store.remove(descriptor);

    mode = 'stall'; const abort = new AbortController();
    const task = store.install(descriptor, abort.signal, value => { if (value.phase === 'downloading' && value.received > 0) abort.abort(); });
    await assert.rejects(task, /取消.*保留/);
    state = await store.state(descriptor); assert.equal(state.ready, false); assert.equal(state.downloadedBytes, 32);
    mode = 'bad-range'; await assert.rejects(store.install(descriptor, signal()), /范围不符/);
    assert.equal((await store.state(descriptor)).downloadedBytes, 32, 'bad response does not truncate partial');
    mode = 'normal'; await new LocalModelStore(directory, transport).install(descriptor, signal());
    assert.ok(requests.some(request => request.range === 'bytes=32-'));
    assert.equal((await store.state(descriptor)).ready, true);
    await store.remove(descriptor);

    mode = 'stall'; await assert.rejects(store.install(descriptor, signal()), /超时.*保留/);
    assert.equal((await store.state(descriptor)).downloadedBytes, 32);
    mode = 'ignore-range'; await store.install(descriptor, signal());
    assert.deepEqual(await readFile(join(installed, 'model.onnx')), content, '200 range fallback truncates and restarts');
    await store.remove(descriptor);

    mode = 'bad-hash'; await assert.rejects(store.install(descriptor, signal()), /SHA-256/);
    assert.equal((await store.state(descriptor)).downloadedBytes, 0);
    assert.equal(await stat(installed).catch(() => null), null);
    mode = 'normal';
    const mutable = structuredClone(descriptor), pending = store.install(mutable, signal());
    mutable.artifacts[0].bytes = 1; mutable.id = 'changed';
    await assert.rejects(new LocalModelStore(directory, transport).install(descriptor, signal()), /正在下载/);
    await assert.rejects(store.remove(descriptor), /正在下载/);
    await assert.rejects(store.acquire(descriptor), /正在下载/);
    assert.equal(await pending, installed, 'in-flight descriptor is immutable');
    assert.equal((await store.state(descriptor)).ready, true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('model paths reject traversal, Windows aliases and symlink caches', async () => {
  for (const model of localModelCatalog) assert.ok(localModelIdentity(model).startsWith(model.id + '-'));
  const native={...miganModel,artifacts:Array.from({length:65},(_,index)=>({...miganModel.artifacts[0],name:`binary-${index}.dll`,role:`binary-${index}`}))};
  assert.throws(()=>localModelIdentity(native),/描述无效/);native.artifacts.length=35;assert.ok(localModelIdentity(native),'native CUDA bundles fit without removing the artifact-count bound');
  const descriptor = structuredClone(localModelCatalog[0]);
  for (const name of ['../model.onnx', 'C:\\escape.onnx', 'NUL.onnx', 'con', 'foo.', 'file.part']) {
    descriptor.artifacts[0].name = name; assert.throws(() => localModelIdentity(descriptor), /描述无效/);
  }
  descriptor.artifacts[0].name = 'det.onnx'; descriptor.artifacts[0].url = 'http://models.test/model';
  assert.throws(() => localModelIdentity(descriptor), /地址无效/);
  const directory = await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!, 'unsafe-'));
  const target = join(directory, 'target'), link = join(directory, 'link'); await mkdir(target);
  await symlink(target, link, 'junction');
  const store = new LocalModelStore(link);
  await assert.rejects(store.state(localModelCatalog[0]), /目录无效/);
  await assert.rejects(store.remove(localModelCatalog[0]), /目录无效/);
  await assert.rejects(store.install(localModelCatalog[0], new AbortController().signal), /目录无效/);
});

test('verified legacy files import offline and are rechecked after copying', async () => {
  const directory = await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!, 'import-'));
  const bytes = Buffer.from('existing model cache'), legacy = join(directory, 'legacy.onnx');
  await writeFile(legacy, bytes);
  const descriptor = structuredClone(miganModel);
  descriptor.artifacts[0].bytes = bytes.length; descriptor.artifacts[0].sha256 = createHash('sha256').update(bytes).digest('hex');
  const store = new LocalModelStore(join(directory, 'library'), async () => { throw Error('unexpected network'); });
  const installed = await store.install(descriptor, new AbortController().signal, () => {}, { repair: legacy });
  assert.deepEqual(await readFile(join(installed, 'migan.onnx')), bytes);
  assert.deepEqual(await readFile(legacy), bytes, 'legacy file remains available to older versions');
  await store.remove(descriptor);
  await writeFile(legacy, Buffer.alloc(bytes.length, 0));
  await assert.rejects(store.install(descriptor, new AbortController().signal, () => {}, { repair: legacy }), /unexpected network/);
  assert.equal((await store.state(descriptor)).ready, false);
  await writeFile(legacy, Buffer.alloc(bytes.length + 1, 0));
  await assert.rejects(store.install(descriptor, new AbortController().signal, () => {}, { repair: legacy }), /unexpected network/, 'oversized legacy cache does not block a fresh download');
});
