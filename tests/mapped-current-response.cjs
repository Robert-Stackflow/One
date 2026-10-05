const fs=require('node:fs/promises');
const path=require('node:path');
const {mapped}=require('./mapped-index-performance.cjs');

async function main(){
  const directory=path.resolve(process.env.ONE_MAPPED_INDEX_DIR||'work/dev-profile/file-index.bin.mapped');
  const current=JSON.parse(await fs.readFile(path.join(directory,'.one-mapped-current.json'),'utf8'));
  if(typeof current.id!=='string'||!/^[a-f0-9]{32}$/.test(current.id))throw new Error('Invalid mapped generation ID');
  const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/mapped-current-response');
  await fs.mkdir(output,{recursive:true});
  const image=path.join(output,'snapshot.base');
  await fs.copyFile(path.join(directory,`.one-mapped-${current.id}.base`),image);
  const exe=path.resolve(process.env.ONE_INDEX_EXE||'dist/native/One.Index.exe');
  const cases=[
    {query:'QQ'},
    {query:'季度'},
    {query:'jdbg'},
    {query:'reprot'},
    {query:'ext:json package'},
    {query:'无匹配_2049'},
    {query:'QQ',progressive:true},
    {query:'jdbg',progressive:true},
    {query:'reprot',progressive:true},
  ];
  const report=await mapped(exe,image,cases);
  const summary={count:report.count,readyMs:report.readyMs,loadedPrivateMiB:report.loaded.private/1048576,settledPrivateMiB:report.settled.private/1048576,queries:report.queries.map(({query,options,total,timings,partial})=>({query,progressive:!!options.progressive,total,first:timings[0],warm:timings[1],partialMs:partial?.wallMs}))};
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
