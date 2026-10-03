// Full frozen production cache; compare the disk reader and generation store
// with the unchanged live executable using owned caches only. No app migration.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto');
const {frozen}=require('./index-load-memory.cjs'),{client,delay,until}=require('./helpers/index-client.cjs'),execute=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const clean=result=>({items:result.items,total:result.total,localTotal:result.localTotal});
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/mapped-launcher-native'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const exe=path.resolve('work/rust-search/release/one-index.exe'),referenceExe=path.resolve('dist/native/One.Index.exe'),source=await frozen(path.resolve('work/dev-profile/file-index.bin')),cache=path.join(profile,'source.bin'),seed=path.join(profile,'seed.bin'),config=path.join(profile,'config.json'),store=path.join(profile,'store');
 await fs.writeFile(cache,source.bytes);if(source.delta)await fs.writeFile(cache+'.delta',source.delta);await fs.writeFile(config,JSON.stringify(source.config));
 const built=JSON.parse((await execute(exe,['mapped-import',cache,seed,config],{windowsHide:true,timeout:60000,maxBuffer:1024*1024})).stdout.trim());
 const report={date:new Date().toISOString(),result:'MEASURED',count:built.count,hashes:{candidate:hash(await fs.readFile(exe)),reference:hash(await fs.readFile(referenceExe)),source:hash(source.bytes)},note:'Full identical production snapshot and delta, hot filesystem cache. Compares ordinary backend with mapped reader and generation store; does not switch the running app.',queries:[]};
 const entry=(id,name,extra={})=>({path:'one-launcher:'+id,name,directory:false,modified:0,size:0,...extra});
 const programs=[entry('app:QQ','QQ',{modified:4321,size:42}),entry('setting:display','显示器 分辨率 缩放'),entry('app:quarter','季度报告'),entry('app:report','Report.txt'),entry('app:unicode','İstanbul Σ'),entry('app:directory','QQ folder',{directory:true,modified:10000000}),...Array.from({length:120},(_,n)=>entry('app:tie-'+String(n).padStart(3,'0'),'QQ'))];
 const rules=[{path:'D:\\Repositories',priority:'uncommon'},{path:'D:\\Repositories\\One',priority:'high'},{path:'C:\\Windows',priority:'uncommon'}];
 const cases=[{query:'app: QQ'},{query:'setting: 分辨率'},{query:'setting: xianshiqi'},{query:'QQ'},{query:'QQ',includeLaunchers:false},{query:'"QQ"'},{query:'季度'},{query:'jdbg',fuzzy:false},{query:'jidubaogao'},{query:'doc: QQ'},{query:'folder:'},{query:'ext:txt Report'},{query:'app: ext:txt Report'},{query:'app: reprt'},{query:'app: "Report.txt"',fuzzy:false,pinyin:false},{query:'app: İstanbul'},{query:'app: Σ'},{query:'app: __absent_2026__'},{query:'QQ',priorities:rules},{query:'ext:json package',priorities:rules,progressive:true},{query:'季度',progressive:true}];
 let reference,read,versioned;
 const persist=()=>fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 const query=(target,options,scope=1)=>target.request({type:'query',scope,includeLaunchers:true,currentFolder:'D:\\Repositories\\One',pinyin:true,fuzzy:true,...options});
 try{
  reference=await client(referenceExe,[cache],source.config);assert.equal(reference.count,built.count);
  read=await client(exe,['mapped-query',seed]);versioned=await client(exe,['mapped-store',seed,store]);const disk=[read,versioned];
  for(const target of [reference,...disk])target.send({type:'launchers',items:programs});
  // App-only filters must complete without touching millions of filesystem rows.
  report.appOnly=await Promise.all(disk.map(async target=>{const value=await query(target,{query:'app: QQ'});assert.equal(value.result.total,122);assert.ok(value.result.elapsed<20);const memory=target.memory();assert.ok(memory.resident<32*1024**2);assert.ok(memory.private<32*1024**2);return{wallMs:value.wallMs,nativeMs:value.result.elapsed,memory};}));
  for(const options of cases){const expected=await query(reference,options),measured=[];for(const target of disk){let firstMs;const value=await target.request({type:'query',scope:1,includeLaunchers:true,currentFolder:'D:\\Repositories\\One',pinyin:true,fuzzy:true,...options},partial=>{firstMs=partial.wallMs;});assert.deepEqual(clean(value.result),clean(expected.result),JSON.stringify(options));if(options.progressive)assert.deepEqual(clean(value.partial),clean(expected.partial));measured.push({wallMs:value.wallMs,nativeMs:value.result.elapsed,firstMs,total:value.result.total});}report.queries.push({options,total:expected.result.total,referenceMs:expected.wallMs,disk:measured});await persist();}
  for(const target of disk){
   const expected=(await query(reference,{query:'app: QQ'})).result;
   const independent=await Promise.all(Array.from({length:30},(_,n)=>query(target,{query:n%2?'app: QQ':'setting: xianshiqi'},100+n)));assert.ok(independent.every(value=>!value.result.cancelled));for(let n=0;n<independent.length;n++)assert.equal(independent[n].result.total,n%2?122:1);
   const burst=await Promise.all(Array.from({length:20},(_,n)=>query(target,{query:n===19?'app: QQ':'__absent_2026__'},500)));assert.deepEqual(clean(burst.at(-1).result),clean(expected));assert.ok(burst.filter(value=>value.result.cancelled).length>=18);for(const value of burst.filter(value=>value.result.cancelled)){assert.equal(value.result.total,0);assert.deepEqual(value.result.items,[]);}
   await assert.rejects(query(target,{query:'x'.repeat(4001)},600),/搜索条件过长/);assert.deepEqual(clean((await query(target,{query:'app: QQ'},600)).result),clean(expected));
  }
  report.scopesAndErrorRecovery=true;
  // Replacement, malformed packets and the shared 3,000-record limit must
  // preserve ordinary-backend behavior, including metadata and display names.
  const bounded=[{...entry('app:ignored','should-not-appear'),path:'D:\\not-a-launcher.txt'},...Array.from({length:3005},(_,n)=>entry('app:limit-'+n,'bounded-launcher-'+n))];
  for(const target of [reference,...disk])target.send({type:'launchers',items:bounded});
  for(const target of [reference,...disk])assert.equal((await query(target,{query:'app: bounded-launcher'})).result.total,3000);
  for(const target of [reference,...disk])target.send({type:'launchers',items:[{path:'broken'}]});
  for(const target of [reference,...disk])assert.equal((await query(target,{query:'app: bounded-launcher'})).result.total,3000);
  for(const target of [reference,...disk])target.send({type:'launchers',items:[]});
  for(const target of [reference,...disk])assert.equal((await query(target,{query:'app:'})).result.total,0);
  for(const target of [reference,...disk])target.send({type:'launchers',items:programs});
  // Launcher replacement does not wait for a disk version merge or persist
  // into its output. Queries after the merge retain the new ephemeral set.
  const merge=versioned.request({type:'compact'});await until(()=>versioned.events.some(value=>value.state==='running'));
  const replacement=[entry('app:new','New independent launcher')];versioned.send({type:'launchers',items:replacement});assert.equal((await query(versioned,{query:'app: New independent launcher'})).result.total,1);await merge;assert.equal((await query(versioned,{query:'app: New independent launcher'})).result.total,1);assert.equal((await query(versioned,{query:'app: QQ'})).result.total,0);report.replacementDuringMerge=true;
  await delay(100);report.idle=disk.map(target=>target.memory());for(const memory of report.idle){assert.ok(memory.private<64*1024**2);assert.ok(memory.resident<64*1024**2);assert.ok(memory.peakPrivate<64*1024**2);}
  await read.stop();read=null;await versioned.stop();versioned=null;await reference.stop();reference=null;
  read=await client(exe,['mapped-query',seed]);versioned=await client(exe,['mapped-store',path.join(profile,'absent-seed'),store]);reference=await client(referenceExe,[cache],source.config);
  for(const target of [reference,read,versioned]){assert.equal(target.count,built.count,'Launchers must not change filesystem counts');assert.equal((await query(target,{query:'app:'})).result.total,0,'Launchers must not survive restart');}
  assert.equal(hash(await fs.readFile(cache)),hash(source.bytes));if(source.delta)assert.equal(hash(await fs.readFile(cache+'.delta')),hash(source.delta));report.result='PASS';report.completeTop100AndPartials=true;report.launchersNotPersisted=true;report.sourceUnchanged=true;await persist();console.log(JSON.stringify({result:'PASS',count:report.count,cases:cases.length,appOnly:report.appOnly,idle:report.idle}));
 }finally{await read?.stop();await versioned?.stop();await reference?.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
