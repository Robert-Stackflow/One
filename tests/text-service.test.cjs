const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild');
test('text comparison pages preserve complete dense content, enforce ownership and release worker/cache',async()=>{
 const base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','text-service');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'runtime-'));
 await build({entryPoints:['src/main/text-worker.ts','src/main/text-service.ts'],outdir:root,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',external:['opencc-js','iconv-lite']});const {TextService}=require(path.join(root,'text-service.cjs')),service=new TextService(()=>{});
 try{
  const left='old🙂\n'.repeat(50000),right='new🙂\n'.repeat(50000),report=await service.run(1,{kind:'compare',left,right,ignoreWhitespace:false});assert.equal(report.grouped,true);assert.ok(report.count>600);let original='',revised='';
  for(let n=0;n<Math.ceil(report.count/report.pageSize);n++){const rows=await service.page(1,report.id,n);assert.ok(rows.length<=100);for(const row of rows){original+=row.leftText;revised+=row.rightText;assert.ok(row.leftText.length<=16000);assert.ok(row.rightText.length<=16000);}}
  assert.equal(original,left);assert.equal(revised,right);assert.equal(service.pool.size,0);assert.equal(report.stats.removedLines,50000);
  await assert.rejects(()=>service.page(2,report.id,0));await assert.rejects(()=>service.page(1,'../other',0));await assert.rejects(()=>service.page(1,report.id,-1));await service.clear(2,report.id);assert.equal((await service.page(1,report.id,0)).length,100);
  const cache=path.join(service.root,report.id);await service.clear(1,report.id);await assert.rejects(()=>service.page(1,report.id,0));assert.equal(await fs.stat(cache).then(()=>true,()=>false),false);
  const unchanged=await service.run(1,{kind:'compare',left:'甲\r\n乙',right:'甲\n乙',ignoreWhitespace:false});assert.equal(unchanged.count,0);
  // Release remains separate from worker retirement; an open comparison survives other text operations.
  const current=await service.run(1,{kind:'compare',left:'a',right:'b',ignoreWhitespace:false});assert.equal(await service.run(1,{kind:'pipeline',text:'abc',steps:[{operation:'upper'}]}),'ABC');assert.ok((await service.page(1,current.id,0)).length);service.release(1);
 }finally{await service.stop();}
 assert.equal(service.pendingTasks,0);assert.equal(await fs.stat(service.root).then(()=>true,()=>false),false);
});
test('cancellation interrupts pathological text work and the next task recovers',async()=>{
 const base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','text-service');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'cancel-'));await build({entryPoints:['src/main/text-worker.ts','src/main/text-service.ts'],outdir:root,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',external:['opencc-js','iconv-lite']});const {TextService}=require(path.join(root,'text-service.cjs'));let started;const running=new Promise(resolve=>started=resolve),service=new TextService(()=>started());
 try{const pending=service.run(1,{kind:'pipeline',text:'a'.repeat(100000)+'!',steps:[{operation:'replace',pattern:'(a+)+$',replacement:'x',regex:true}]});const rejected=assert.rejects(pending,/已停止/);await running;service.cancel(1);await rejected;assert.equal(await service.run(1,{kind:'pipeline',text:'恢复',steps:[{operation:'upper'}]}),'恢复');}finally{await service.stop();}assert.equal(service.pendingTasks,0);
});
test('batch processing releases its worker after saving and can start another task',async()=>{
 const base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','text-service');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'batch-'));await build({entryPoints:['src/main/text-worker.ts','src/main/text-service.ts'],outdir:root,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',external:['opencc-js','iconv-lite']});const {TextService}=require(path.join(root,'text-service.cjs')),service=new TextService(()=>{});
 try{
  const source=path.join(root,'source.txt');await fs.writeFile(source,'  第一行  \n  第二行  ');const request={kind:'batch',request:{paths:[source],steps:[{operation:'clean'}],inputEncoding:'自动',outputEncoding:'UTF-8',output:root,extensions:'txt',recursive:false,merge:true,separator:'\n'}};
  const result=await service.run(1,request);assert.equal(result.completed,1);assert.equal(await fs.readFile(path.join(result.output,'合并结果.txt'),'utf8'),'第一行\r\n第二行');assert.equal(service.pool.size,0);
  assert.equal(await service.run(1,{kind:'pipeline',text:'恢复',steps:[{operation:'upper'}]}),'恢复');
 }finally{await service.stop();}assert.equal(service.pendingTasks,0);
});
