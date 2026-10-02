const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{build}=require('esbuild');
const {frozen}=require('./index-load-memory.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const within=(file,folder)=>file.toLowerCase().replaceAll('/','\\').startsWith(folder.toLowerCase().replace(/[\\/]$/,'')+'\\');
async function waitFor(check){for(let n=0;n<1000;n++){if(check())return;await sleep(20);}throw Error('Index did not become ready');}
async function create(out,exe,settings,snapshot){
 const root=path.join(out,'profile');await fs.mkdir(path.join(root,'main'),{recursive:true});await fs.mkdir(path.join(root,'native'),{recursive:true});await fs.copyFile(exe,path.join(root,'native','One.Index.exe'));
 await build({entryPoints:['src/main/search-service.ts'],outfile:path.join(root,'main','service.cjs'),bundle:true,platform:'node'});
 const cache=path.join(root,'index.bin');if(snapshot){await fs.writeFile(cache,snapshot.bytes);if(snapshot.delta)await fs.writeFile(cache+'.delta',snapshot.delta);}
 let wasRunning=false;const {SearchService}=require(path.join(root,'main','service.cjs')),service=new SearchService(cache,settings,s=>{wasRunning ||= s.running;});await waitFor(()=>wasRunning&&!service.state().running&&service.state().count>0);return service;
}
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-local-native');await fs.mkdir(out,{recursive:true});const exe=path.resolve('work/rust-search/release/one-index.exe'),fixtures=path.join(out,'fixtures'),local=path.join(fixtures,'中文 & $()'),adjacent=local+'-other',excluded=path.join(local,'excluded');
 for(const dir of [fixtures,local,adjacent,excluded])await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(local,'n-e-e-d-l-e-m-a-t-c-h.txt'),'local fuzzy');await fs.writeFile(path.join(adjacent,'needle-match.txt'),'global exact');await fs.writeFile(path.join(local,'季度报告.txt'),'pinyin');await fs.writeFile(path.join(excluded,'needle-match.txt'),'excluded');await fs.writeFile(path.join(local,'needle-match.json'),'json');
 let service;const report={result:'PASS',cases:[]};
 try{
  service=await create(path.join(out,'small'),exe,{roots:[fixtures],excluded:[excluded],maxEntries:1000,fuzzy:true,pinyin:true});
  const query=async(query,folder=local,scope=1)=>{const partial=[],at=performance.now(),result=await service.query(query,false,folder,scope,false,r=>partial.push({...r,wallMs:performance.now()-at}));return{partial,result,wallMs:performance.now()-at};};
  let r=await query('needle-match');assert.equal(r.partial.length,1);assert.equal(r.partial[0].total,2);assert.equal(r.result.total,3);assert.equal(r.result.localTotal,2);assert.ok(r.result.items.slice(0,2).every(item=>within(item.path,local)));assert.ok(r.result.items[2].path.startsWith(adjacent));assert.equal(r.result.items.some(item=>within(item.path,excluded)),false);
  r=await query('ext:json needle-match');assert.equal(r.partial[0].total,1);assert.equal(r.result.total,1);
  r=await query('jdbg');assert.ok(r.partial[0].items.some(item=>item.name==='季度报告.txt'));assert.equal(r.partial[0].items[0].matchKind,'pinyin');
  r=await query('needle-match',local+'-missing');assert.equal(r.partial[0].total,0);assert.equal(r.result.total,3);
  const baseline=await service.query('needle-match',false,'',1,false);assert.equal(baseline.items[0].name,'needle-match.txt');
  const independent=await Promise.all(Array.from({length:12},(_,n)=>query('needle-match',local,100+n)));assert.ok(independent.every(r=>r.partial.length===1&&!r.result.cancelled&&r.result.total===3));
  const rapid=await Promise.all(Array.from({length:40},(_,n)=>query(n===39?'needle-match':'jdbg',local,999)));assert.ok(!rapid.at(-1).result.cancelled);assert.equal(rapid.at(-1).result.total,3);assert.equal(service.pending.size,0);report.filteredLocalFirst=true;report.exclusionsAndAdjacentDirectoryBoundaries=true;report.localFuzzyBeforeGlobalExact=true;report.independentScopes=12;report.latestOf40Retained=true;
  await service.stop();service=undefined;
  const snapshot=await frozen(path.resolve('work/dev-profile/file-index.bin'));service=await create(path.join(out,'large'),exe,{...snapshot.config,fuzzy:true,pinyin:true},snapshot);
  const count=service.state().count;assert.ok(count>=snapshot.count-10000,JSON.stringify({count,snapshot:snapshot.count,state:service.state()}));report.indexCount=count;report.snapshotCount=snapshot.count;report.journalBytes=snapshot.deltaBytes;
  for(const [text,folder]of [['search',path.resolve('src/renderer')],['package',path.resolve('.')],['不存在的名字_2049',path.resolve('src/renderer')]]){
   r=await query(text,folder);assert.equal(r.partial.length,1);assert.ok(r.partial[0].items.every(item=>within(item.path,folder)));assert.equal(r.result.localTotal,r.partial[0].total);assert.ok(r.result.items.slice(0,Math.min(100,r.result.localTotal)).every(item=>within(item.path,folder)));
   const all=await service.query(text,false,'',1,false);assert.equal(r.result.total,all.total);assert.ok(!r.result.cancelled);assert.equal(service.state().count,count);assert.equal(service.pending.size,0);
   report.cases.push({query:text,folder,localCount:r.partial[0].total,total:r.result.total,firstMs:r.partial[0].elapsed,firstWallMs:r.partial[0].wallMs,completeMs:r.result.elapsed});
  }
  assert.ok(report.cases[0].localCount>0);assert.ok(report.cases[0].firstMs<30,'Narrow current directory should respond without traversing millions of records');assert.ok(report.cases[0].firstMs<report.cases[0].completeMs);await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await service?.stop();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
