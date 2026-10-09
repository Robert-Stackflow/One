const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{buildSync}=require('esbuild');
test('system menu requests consume only fresh, bounded selections in the owning profile',async t=>{
 const base=path.resolve('work/temp');await fs.mkdir(base,{recursive:true});const out=await fs.mkdtemp(path.join(base,'shell-request-tests-'));
 t.after(async()=>{const relative=path.relative(base,out);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(out,{recursive:true,force:true});});
 const bundle=path.join(out,'request.cjs');buildSync({entryPoints:['src/main/shell-request.ts'],outfile:bundle,bundle:true,platform:'node',target:'node22'});const {readShellRequest}=require(bundle),profile=await fs.mkdtemp(path.join(out,'profile-')),root=path.join(profile,'shell-requests');await fs.mkdir(root);
 const file=path.join(profile,'中文 文件.txt'),folder=path.join(profile,'选中目录'),invoke=p=>readShellRequest(['--one-shell-request='+p],profile),request=async(value,dir=root,name=randomUUID()+'.json')=>{const p=path.join(dir,name);await fs.writeFile(p,JSON.stringify(value));return p;};
 await t.test('Unicode selections and duplicates are consumed once',async()=>{const p=await request({tool:'rename',paths:[file,folder,file]});assert.deepEqual(await invoke(p),{tool:'rename',paths:[file,folder]});await assert.rejects(fs.stat(p),{code:'ENOENT'});await assert.rejects(invoke(p),{code:'ENOENT'});assert.equal(await readShellRequest([],profile),undefined);});
 await t.test('foreign paths and invalid request names are left untouched',async()=>{for(const p of [await request({tool:'rename',paths:[file]},profile),await request({tool:'rename',paths:[file]},root,'-'.repeat(36)+'.json')]){await assert.rejects(invoke(p),/路径无效/);assert.ok((await fs.stat(p)).isFile());}});
 await t.test('invalid selection limits, types and path data are rejected',async()=>{for(const value of [{tool:'delete',paths:[file]},{tool:'rename',paths:[]},{tool:'locksmith',paths:Array(33).fill(file)},{tool:'rename',paths:Array(4097).fill(file)},{tool:'rename',paths:['relative.txt']},{tool:'rename',paths:[file+'\n']},{tool:'rename',paths:[17]}]){const p=await request(value);await assert.rejects(invoke(p),/选择无效/);assert.ok((await fs.stat(p)).isFile());}});
 await t.test('expired and oversized requests do not run',async()=>{const stale=await request({tool:'rename',paths:[file]});await fs.utimes(stale,new Date(0),new Date(0));await assert.rejects(invoke(stale),/失效/);const large=await request({tool:'rename',paths:[file]});await fs.writeFile(large,' '.repeat(4*1024*1024+1));await assert.rejects(invoke(large),/失效/);});
 await t.test('every archive action validates all files, bounds batches and folds Windows case duplicates',async()=>{
  const files=['a.ZIP','b.7z.001','c.tar.gz','d.ZIPX','e.CAB','f.LHA','g.ISO','h.WIM','i.tar.ZSTD','j.JAR','k.APK'].map(name=>path.join(profile,name));
  for(const tool of ['archive-extract','archive-smart','archive-here','archive-folder']){
   const p=await request({tool,paths:[...files,files[0].toLowerCase()]});assert.deepEqual(await invoke(p),{tool,paths:files});
   const mixed=await request({tool,paths:[...files,file]});await assert.rejects(invoke(mixed),/不是支持的压缩包/);assert.ok((await fs.stat(mixed)).isFile());
   const over=await request({tool,paths:Array(129).fill(files[0])});await assert.rejects(invoke(over),/选择无效/);
  }
  assert.equal((await invoke(await request({tool:'archive-create',paths:[file,folder]}))).paths.length,2);
 });
});
