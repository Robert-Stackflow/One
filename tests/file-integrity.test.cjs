const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {buildSync}=require('esbuild');
const output=path.resolve('work/file-integrity-test.cjs');
buildSync({entryPoints:['src/main/file-integrity.ts'],outfile:output,bundle:true,platform:'node',target:'node22',format:'cjs'});
const {runIntegrity}=require(output);

test('SHA-256 manifest detects changed, missing and added files without accepting traversal',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'one-integrity-'));
 const a=path.join(root,'a.txt'),b=path.join(root,'b.txt');
 await fs.writeFile(a,'alpha');await fs.writeFile(b,'beta');
 const execute=async task=>{const report={id:'test',kind:task.kind,created:Date.now(),count:0,pageSize:100,summary:'',stats:{},issues:[],issueCount:0},rows=[];await runIntegrity(task,report,rows,()=>{},(file,error)=>{report.issueCount++;report.issues.push({path:file,error:String(error)});});return{report,rows};};
 try{
  const created=await execute({kind:'integrity-create',roots:[root],recursive:true});
  assert.equal(created.report.stats.files,2);assert.ok(created.report.manifest?.startsWith(root));
  const manifest=JSON.parse(await fs.readFile(created.report.manifest,'utf8'));
  assert.deepEqual(manifest.entries.map(e=>e.path),['a.txt','b.txt']);
  assert.equal((await execute({kind:'integrity-verify',manifest:created.report.manifest})).report.stats.matched,2);
  await fs.writeFile(a,'ALPHA');await fs.unlink(b);await fs.writeFile(path.join(root,'c.txt'),'new');
  const checked=await execute({kind:'integrity-verify',manifest:created.report.manifest});
  assert.deepEqual(checked.rows.map(row=>row.status).sort(),['内容不同','新增','缺失'].sort());
  manifest.entries[0].path='../outside.txt';
  const malicious=path.join(root,'malicious.sha256.json');await fs.writeFile(malicious,JSON.stringify(manifest));
  await assert.rejects(execute({kind:'integrity-verify',manifest:malicious}),/无效文件记录/);
 }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir(),'one-integrity-')));await fs.rm(root,{recursive:true,force:true});}
});
test('verification streams dense change rows into result pages instead of retaining them all',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'one-integrity-stream-')),pages=await fs.mkdtemp(path.join(os.tmpdir(),'one-integrity-pages-'));
 try{
  const entries=[];for(let index=0;index<205;index++){const name=`entry-${String(index).padStart(3,'0')}.txt`;entries.push({path:name,size:1,sha256:'0'.repeat(64)});await fs.writeFile(path.join(root,name),'');}
  const manifest=path.join(root,'one-integrity-stream.sha256.json');await fs.writeFile(manifest,JSON.stringify({format:'one-integrity',version:1,algorithm:'sha256',created:Date.now(),entries}));
  const report={id:'stream',kind:'integrity-verify',created:Date.now(),count:0,pageSize:100,summary:'',stats:{},issues:[],issueCount:0},rows=[],progress=[];
  await runIntegrity({kind:'integrity-verify',manifest},report,rows,value=>progress.push(value),()=>{},pages);
  assert.equal(rows.length,0);assert.equal(report.count,205);assert.equal(report.stats.streamed,1);assert.equal(progress.at(-1).completed,205);assert.equal(JSON.parse(await fs.readFile(path.join(pages,'page-0.json'),'utf8')).length,100);assert.equal(JSON.parse(await fs.readFile(path.join(pages,'page-2.json'),'utf8')).length,5);
 }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir(),'one-integrity-stream-')));assert.ok(path.resolve(pages).startsWith(path.resolve(os.tmpdir(),'one-integrity-pages-')));await Promise.all([fs.rm(root,{recursive:true,force:true}),fs.rm(pages,{recursive:true,force:true})]);}
});
