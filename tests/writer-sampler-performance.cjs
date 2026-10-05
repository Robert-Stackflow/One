const {buildSync}=require('esbuild');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const assert=require('node:assert/strict');
const output=path.resolve('work/writer-sampler-performance');
buildSync({entryPoints:['src/main/disk-monitor.ts'],outdir:output,bundle:true,platform:'node',outExtension:{'.js':'.cjs'}});
const {WriterSampler}=require(path.join(output,'disk-monitor.cjs'));
const count=1500;
const processes=Array.from({length:count},(_,i)=>({pid:i+1000,started:String(i),name:`writer-${i}`,path:`C:\\writers\\${i}.exe`,bytes:10000+i,operations:100+i}));
const fileWrites=processes.map(p=>({pid:p.pid,bytes:1024,operations:4,files:[],kinds:{file:1024}})).reverse();
const raw=created=>({created,trace:'active',processes,fileWrites});
const sampler=new WriterSampler();sampler.sample(raw(1000));
const times=[];let result;
for(let i=0;i<12;i++){
 const start=performance.now();result=sampler.sample(raw(2000+i*1000));times.push(performance.now()-start);
}
assert.equal(result.length,100);assert.equal(result[0].bytesPerSecond,1024);
times.sort((a,b)=>a-b);
console.log(JSON.stringify({passed:true,processes:count,tracedWriters:fileWrites.length,medianSampleMs:Number(times[6].toFixed(2)),p95SampleMs:Number(times[11].toFixed(2))}));
