const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {client}=require('./helpers/index-client.cjs');

async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-launcher-first-native');
 await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'snapshot-'));
 const source=path.resolve(process.env.ONE_AUDIT_MAPPED||'work/dev-profile/file-index.bin.mapped');
 const manifest=JSON.parse(await fs.readFile(path.join(source,'.one-mapped-current.json'),'utf8'));
 assert.match(manifest.id,/^[a-f0-9]{32}$/);
 const image=path.join(profile,'image.bin'),delta=path.join(profile,'image.delta');
 const label='OneIndexRareLauncher97531',launcher={path:'one-launcher:setting:rare-97531',name:label,directory:false,size:0,modified:0};
 const programs=[launcher,{path:'one-launcher:app:QQ',name:'QQ',directory:false,size:0,modified:0}];
 const record=[],baseline=new Map();
 try{
  await fs.copyFile(path.join(source,`.one-mapped-${manifest.id}.base`),image);
  await fs.copyFile(path.join(source,`.one-mapped-${manifest.id}.delta`),delta);
  for(const side of process.env.ONE_INDEX_BEFORE?['before','after']:['after']){
   const exe=path.resolve(side==='before'?process.env.ONE_INDEX_BEFORE:(process.env.ONE_INDEX_AFTER||'dist/native/One.Index.exe'));
   const native=await client(exe,['mapped-query',image,delta]);
   try{
    native.send({type:'launchers',items:programs});
    const partials=[];
    const response=await native.request({type:'query',scope:500,query:label,includeLaunchers:true,progressive:true,currentFolder:'',fuzzy:true,pinyin:true,priorities:[]},part=>partials.push({wallMs:part.wallMs,paths:part.result.items.map(item=>item.path),total:part.result.total}));
    assert.equal(response.result.total,1);
    assert.equal(response.result.items[0].path,launcher.path);
    record.push({side,wallMs:response.wallMs,partials});
    for(const query of ['QQ','README.md','folder: downloads','reprot','"D:/Repositories/One"']){
     const result=await native.request({type:'query',scope:501,query,includeLaunchers:true,progressive:true,currentFolder:'',fuzzy:true,pinyin:true,priorities:[]});
     const final={items:result.result.items,total:result.result.total,localTotal:result.result.localTotal};
     if(side==='before')baseline.set(query,final);
     else if(baseline.has(query))assert.deepEqual(final,baseline.get(query),query);
    }
   }finally{await native.stop();}
  }
  const before=record.find(item=>item.side==='before'),after=record.find(item=>item.side==='after');
  if(before)assert.equal(before.partials.length,0,'Reference waits for the full file scan');
  assert.ok(after.partials.length>0,'Launcher should appear before the full file scan');
  assert.equal(after.partials[0].total,1);
  assert.deepEqual(after.partials[0].paths,[launcher.path]);
  assert.ok(after.partials[0].wallMs<after.wallMs,'Early result must precede completion');
  console.log(JSON.stringify({result:'PASS',beforeMs:before?.wallMs,firstMs:after.partials[0].wallMs,afterMs:after.wallMs,comparedQueries:baseline.size,generation:manifest.id}));
 }finally{
  const resolved=await fs.realpath(profile),parent=await fs.realpath(out);
  assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
