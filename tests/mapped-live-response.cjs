// Measure the current immutable disk generation without changing the running app.
// A temporary hard link pins the generation if the background writer rotates it.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {mapped}=require('./mapped-index-performance.cjs');

async function main(){
 const root=path.resolve('work/current/mapped-live-response');
 const store=path.resolve(process.env.ONE_AUDIT_MAPPED_STORE||'work/dev-profile/file-index.bin.mapped');
 const exe=path.resolve(process.env.ONE_AUDIT_INDEX_EXE||'work/rust-search/release/one-index.exe');
 await fs.mkdir(root,{recursive:true});
 const snapshot=await fs.mkdtemp(path.join(root,'snapshot-')),image=path.join(snapshot,'index.base');
 let linked=false;
 try{
  let generation;
  for(let attempt=0;attempt<4;attempt++){
   const current=JSON.parse(await fs.readFile(path.join(store,'.one-mapped-current.json'),'utf8'));
   assert.match(current.id,/^[a-f0-9]{32}$/);
   try{
    await fs.link(path.join(store,`.one-mapped-${current.id}.base`),image);
    generation=current.id;linked=true;break;
   }catch(error){if(error.code!=='ENOENT'||attempt===3)throw error;}
  }
  const queryPath='"'+path.resolve('.').replaceAll('\\','/')+'"';
  const cases=['QQ','季度','reprot','无匹配_2049','ext:json package',queryPath].map(query=>({query,currentFolder:path.resolve('.')}));
  const result=await mapped(exe,image,cases);
  assert.ok(result.count>0);
  const report={date:new Date().toISOString(),generation,count:result.count,imageBytes:(await fs.stat(image)).size,readyMs:result.readyMs,diagnosticIdlePrivateMiB:result.settled.private/1048576,note:'Read-only diagnostic base generation; no live overlay or launcher entries. The diagnostic command validates mapped text on each query, while the app caches validation after its first query, so these timings are not end-to-end app latency. Helper memory excludes the live app. Each query is measured twice; the second run has warmer file-system pages.',queries:result.queries.map(q=>({query:q.query,total:q.total,timings:q.timings}))};
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }finally{
  if(linked)await fs.unlink(image);
  await fs.rmdir(snapshot);
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
