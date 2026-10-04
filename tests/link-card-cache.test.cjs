const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('esbuild');

async function main(){
  const output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/link-card-cache');
  await fs.mkdir(output,{recursive:true});
  const outfile=path.join(output,'link-card.cjs');
  await build({entryPoints:['src/main/link-card.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
  const {LinkCardCache}=require(outfile);

  let calls=0;
  const image='data:image/png;base64,'+'A'.repeat(900_000);
  const cache=new LinkCardCache(async url=>{calls++;return {domain:url.hostname,title:url.pathname,description:'',image};},4*1024*1024,10);
  for(let i=0;i<5;i++)await cache.get(`https://example.com/${i}`);
  assert.ok(cache.retainedBytes<=4*1024*1024);
  assert.equal(cache.size,2,'large preview images must evict old cards by byte budget');
  await cache.get('https://example.com/4');assert.equal(calls,5,'recent card should remain cached');
  await cache.get('https://example.com/0');assert.equal(calls,6,'evicted card should be fetched again');

  let clock=1000,loads=0;
  const expiring=new LinkCardCache(async url=>{loads++;return {domain:url.hostname,title:String(loads),description:''};},1024,2,500,()=>clock);
  const first=expiring.get('https://example.com/a');
  assert.strictEqual(expiring.get('https://example.com/a'),first,'simultaneous hovers should share one request');
  await first;assert.equal(loads,1);
  clock=1600;await expiring.get('https://example.com/a');assert.equal(loads,2,'expired metadata should refresh');
  await expiring.get('https://example.com/b');await expiring.get('https://example.com/c');assert.equal(expiring.size,2,'metadata-only cards must respect the entry limit');
  assert.throws(()=>expiring.get('ftp://example.com/'),/只支持网页链接/);
  console.log(JSON.stringify({result:'PASS',retainedBytes:cache.retainedBytes,retainedEntries:cache.size,loads:calls}));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
