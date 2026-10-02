const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','maintenance-batches.cjs');fs.mkdirSync(path.dirname(output),{recursive:true});require('esbuild').buildSync({entryPoints:['src/shared/maintenance-batches.ts'],outfile:output,bundle:true,platform:'node'});const {applyMaintenanceBatches}=require(output);
test('full maintenance selections respect worker limits, preserve order and aggregate bounded failure details',async()=>{
 const ids=Array.from({length:2501},(_,i)=>'entry-'+i),batches=[],updates=[];const result=await applyMaintenanceBatches(ids,async batch=>{batches.push(batch);return{succeeded:batch.length-1,bytes:batch.length*20,failedCount:700,failed:Array.from({length:700},(_,i)=>({name:batch[0]+'-'+i,error:'已变化'}))};},result=>updates.push(result.succeeded));
 assert.deepEqual(batches.map(b=>b.length),[1000,1000,501]);assert.deepEqual(batches.flat(),ids);assert.equal(result.succeeded,2498);assert.equal(result.bytes,50020);assert.equal(result.failedCount,2100);assert.equal(result.failed.length,500);assert.deepEqual(updates,[999,1998,2498]);
});
test('invalid choices never start work and infrastructure errors stop later batches while retaining reported progress',async()=>{
 let calls=0,progress;await assert.rejects(applyMaintenanceBatches(['duplicate','duplicate'],async()=>{calls++;}),/选择无效/);assert.equal(calls,0);await assert.rejects(applyMaintenanceBatches([],async()=>{calls++;}),/选择无效/);
 await assert.rejects(applyMaintenanceBatches(Array.from({length:3000},(_,i)=>String(i)),async ids=>{if(++calls===2)throw Error('worker stopped');return{succeeded:ids.length,bytes:100,failed:[]};},result=>progress={...result}),/worker stopped/);assert.equal(calls,2);assert.equal(progress.succeeded,1000);assert.equal(progress.bytes,100);
});
