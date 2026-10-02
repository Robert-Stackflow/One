const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
async function root(){const base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','storage');await fs.mkdir(base,{recursive:true});return fs.mkdtemp(path.join(base,'case-'));}
test('verification cleanup enforces count and bytes, preserves live/unmarked directories and never follows junctions',async()=>{
 const {pruneWorkspace,removeGenerated}=await import('../scripts/workspace.mjs'),base=await root(),current=path.join(base,'current');
 await fs.mkdir(current);await fs.writeFile(path.join(base,'.one-generated-workspace'),'test');
 async function record(name,time,active){const file=path.join(current,name);await fs.mkdir(file);await fs.writeFile(path.join(file,'.one-generated-case'),'test');await fs.writeFile(path.join(file,'result.json'),'{}');if(active)await fs.writeFile(path.join(file,'.active'),String(active));await fs.utimes(file,new Date(time),new Date(time));return file;}
 const oldest=await record('old',1000),middle=await record('middle',2000,2147483647),newest=await record('new',3000),live=await record('live',4000,process.pid),unknown=path.join(current,'unknown');await fs.mkdir(unknown);await fs.writeFile(path.join(unknown,'keep.txt'),'keep');
 const outside=path.join(base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');await fs.symlink(outside,path.join(oldest,'link'),'junction');await fs.utimes(oldest,new Date(1000),new Date(1000));
 await pruneWorkspace(base,{cases:2,records:24576,fixtures:0});
 assert.equal(await fs.stat(oldest).catch(()=>null),null);for(const file of [middle,newest,live,unknown,outside])assert.ok(await fs.stat(file));
 await assert.rejects(()=>removeGenerated(current,current),/越界/);await assert.rejects(()=>removeGenerated(current,outside),/越界/);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
 const fixtures=path.join(current,'fixtures');await fs.mkdir(fixtures);await fs.writeFile(path.join(fixtures,'fixture'),'large');await pruneWorkspace(base,{cases:2,records:16384,fixtures:0});assert.ok(await fs.stat(fixtures));
 await fs.rm(path.join(live,'.active'));await pruneWorkspace(base,{cases:2,records:16384,fixtures:0});assert.equal(await fs.stat(fixtures).catch(()=>null),null);
});
test('release retention compares numeric versions and keeps two usable versions while staging is protected',async()=>{
 const {newestVersions,releases,retainReleases,staging,removeRelease}=await import('../scripts/release.mjs'),base=await root();
 assert.deepEqual(newestVersions(['0.9.0','0.10.0','0.10.0','invalid']),['0.10.0','0.9.0']);
 for(const version of ['0.9.0','0.10.0','1.0.0']){const folder=path.join(base,version,'win-unpacked');await fs.mkdir(path.join(folder,'resources'),{recursive:true});await fs.writeFile(path.join(folder,'One.exe'),'fixture');await fs.writeFile(path.join(folder,'resources','app.asar'),'fixture');}
 await fs.mkdir(path.join(base,'9.0.0'));assert.deepEqual(await releases(base),['1.0.0','0.10.0','0.9.0']);
 assert.deepEqual(await retainReleases(base),{retained:['1.0.0','0.10.0'],removed:['0.9.0']});await assert.rejects(()=>removeRelease(base,base),/越界/);
 const stage=await staging(base);await fs.writeFile(path.join(stage,'old-data'),'fixture');assert.equal(await staging(base),stage);assert.equal(await fs.stat(path.join(stage,'old-data')).catch(()=>null),null);
 await fs.rm(path.join(stage,'.one-generated-release'));await assert.rejects(()=>staging(base),/缺少标记/);
});
test('release validation checks native archive paths, unpacked helpers, version and byte content',async()=>{
 const {validateRelease}=await import('../scripts/release.mjs'),asar=require('@electron/asar'),base=await root(),source=path.join(base,'source'),candidate=path.join(base,'candidate');
 await fs.mkdir(path.join(source,'dist','main'),{recursive:true});await fs.mkdir(path.join(source,'dist','native'));await fs.mkdir(path.join(candidate,'win-unpacked','resources'),{recursive:true});
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({version:'1.0.0'}));await fs.writeFile(path.join(source,'dist','main','index.cjs'),'fixture main');await fs.writeFile(path.join(source,'dist','native','Helper.exe'),'fixture native');await fs.writeFile(path.join(candidate,'win-unpacked','One.exe'),'fixture executable');
 await asar.createPackageWithOptions(source,path.join(candidate,'win-unpacked','resources','app.asar'),{unpack:'**/*.exe'});
 assert.deepEqual(await validateRelease(candidate,source,'1.0.0'),{version:'1.0.0',checked:2});await assert.rejects(()=>validateRelease(candidate,source,'2.0.0'),/版本不一致/);
 await fs.writeFile(path.join(source,'dist','main','index.cjs'),'changed');await assert.rejects(()=>validateRelease(candidate,source,'1.0.0'),/内容与当前构建不同/);
});
