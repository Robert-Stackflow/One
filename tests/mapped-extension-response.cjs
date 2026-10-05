const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {mapped}=require('./mapped-index-performance.cjs');

async function main(){
  const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/mapped-current-response');
  const image=path.join(output,'snapshot.base');
  const before=path.join(output,'before.exe');
  const after=path.resolve('work/rust-search/release/one-index.exe');
  const cases=[
    {query:'ext:json package'},
    {query:'ext:mdx'},
    {query:'doc: readme'},
    {query:'pic: png'},
    {query:'folder: downloads'},
    {query:'QQ'},
    {query:'reprot'},
  ];
  const rounds=[];
  for(let n=0;n<2;n++){
    const round={};
    for(const side of n%2?['after','before']:['before','after'])round[side]=await mapped(side==='before'?before:after,image,cases);
    assert.equal(round.before.count,round.after.count);
    for(let i=0;i<cases.length;i++){
      assert.equal(round.before.queries[i].total,round.after.queries[i].total,cases[i].query);
      assert.deepEqual(round.before.queries[i].items,round.after.queries[i].items,cases[i].query);
    }
    rounds.push(round);
  }
  const average=(side,index,key)=>rounds.flatMap(round=>round[side].queries[index].timings).reduce((sum,timing)=>sum+timing[key],0)/4;
  const queries=cases.map((value,i)=>({query:value.query,beforeMs:average('before',i,'wallMs'),afterMs:average('after',i,'wallMs'),beforeCpuMs:average('before',i,'cpuMs'),afterCpuMs:average('after',i,'cpuMs')}));
  const report={count:rounds[0].before.count,resultsIdentical:true,queries};
  await fs.writeFile(path.join(output,'extension-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
