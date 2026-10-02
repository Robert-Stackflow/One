const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild');
test('real directory workers share live snapshots, isolate owners, refresh changes and release references',async()=>{
 const output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work','directory-worker-test');await fs.mkdir(output,{recursive:true});
 await build({entryPoints:['src/main/directory-service.ts','src/main/directory-worker.ts'],bundle:true,platform:'node',outdir:output,outExtension:{'.js':'.cjs'}});
 const {DirectoryService}=require(path.join(output,'directory-service.cjs')),service=new DirectoryService(),root=await fs.mkdtemp(path.join(output,'files-'));
 try{
  await fs.mkdir(path.join(root,'nested'));await fs.writeFile(path.join(root,'item2.txt'),'two');await fs.writeFile(path.join(root,'item10.txt'),'ten');
  const [first,retained]=await Promise.all([service.open(1,root,path.join(root,'item10.txt')),service.open(1,root)]);assert.equal(first.id,retained.id);assert.equal(first.count,3);assert.equal(first.position,2);
  const other=await service.open(2,root);assert.notEqual(other.id,first.id);await assert.rejects(service.page(2,first.id,0,128),/目录已关闭/);
  service.release(1,first.id);assert.equal((await service.page(1,retained.id,0,128)).entries[2].name,'item10.txt');
  await fs.writeFile(path.join(root,'last.txt'),'new');const freshTime=new Date(Date.now()+2000);await fs.utimes(root,freshTime,freshTime);
  const fresh=await service.open(1,root);assert.notEqual(fresh.id,first.id);assert.equal(fresh.count,4);assert.equal((await service.page(1,first.id,0,128)).total,3);
  service.release(1,retained.id);await assert.rejects(service.page(1,first.id,0,128),/目录已关闭/);
  const freshAgain=await service.open(1,root);assert.equal(freshAgain.id,fresh.id);service.release(1,fresh.id);assert.equal((await service.page(1,freshAgain.id,0,128,'LAST')).total,1);service.release(1,freshAgain.id);await assert.rejects(service.page(1,freshAgain.id,0,128),/目录已关闭/);
  assert.equal((await service.page(2,other.id,0,128)).total,3);service.close(2);
  const pending=service.open(3,root);service.close(3);await assert.rejects(pending,/预览已关闭/);
 }finally{for(const owner of [1,2,3])service.close(owner);}
});
