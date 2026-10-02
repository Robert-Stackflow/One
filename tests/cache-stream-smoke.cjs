const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/cache-stream-smoke'),root=path.join(output,'files');await fs.mkdir(root,{recursive:true});
 const entries=Array.from({length:1200},(_,i)=>path.join(root,'entry-'+i+'.tmp'));let next=0;await Promise.all(Array.from({length:16},async()=>{while(next<entries.length)await fs.writeFile(entries[next++],Buffer.alloc(1000));}));
 await require('esbuild').build({entryPoints:['src/main/native-scan.ts'],outfile:'dist/main/native-scan-test.cjs',bundle:true,platform:'node'});const {nativeCacheFiles,nativeCacheRemove}=require('../dist/main/native-scan-test.cjs');
 const scan=await nativeCacheFiles(root,0);assert.equal(scan.files.length,1200);await fs.writeFile(entries[0],'changed after scan');const progress=[],at=performance.now(),result=await nativeCacheRemove(root,scan.files,p=>progress.push(p));assert.equal(result.items,1199);assert.equal(result.bytes,1199000);assert.equal(result.failedCount,1);assert.equal(await fs.readFile(entries[0],'utf8'),'changed after scan');assert.equal((await fs.readdir(root)).length,1);assert.ok(progress.every(p=>p.completed>0&&p.completed<=1200&&p.total===1200));
 const evidence={result:'PASS',files:1200,removed:result.items,changedFileRetained:true,progressEvents:progress.length,elapsedMs:performance.now()-at};await fs.writeFile(path.join(output,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
