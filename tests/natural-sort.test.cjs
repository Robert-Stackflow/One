const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('esbuild');

let compareNatural;
before(async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','natural-sort');
 await fs.mkdir(out,{recursive:true});
 await build({entryPoints:['src/shared/natural-sort.ts'],outfile:path.join(out,'sort.cjs'),bundle:true,platform:'node'});
 ({compareNatural}=require(path.join(out,'sort.cjs')));
});

test('large Chinese and numeric file lists keep the existing rename and batch order',()=>{
 const parts=['文件','目录','项目','资料','alpha','Z','🙂','é','_','-','.', '空 格'];
 let seed=817263;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const paths=Array.from({length:5000},(_,i)=>`D:\\${parts[random()%parts.length]}${random()%180}\\${parts[random()%parts.length]}${random()%10000}-${i%5}.txt`);
 paths.push('D:\\文件2.txt','D:\\文件10.txt','D:\\文件02.txt','D:\\文件2.txt');
 const expected=paths.slice().sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
 const actual=paths.slice().sort(compareNatural);
 assert.deepEqual(actual,expected);
});
