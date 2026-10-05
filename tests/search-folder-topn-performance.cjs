const {buildSync}=require('esbuild');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const path=require('node:path');
const {createRequire}=require('node:module');
const fs=require('node:fs');

const compiled=buildSync({entryPoints:[path.resolve('src/shared/top-n.ts')],bundle:true,platform:'node',format:'cjs',write:false});
const localRequire=createRequire(path.resolve('tests/search-folder-topn-performance.cjs'));
const moduleValue={exports:{}};
new Function('require','module','exports',compiled.outputFiles[0].text)(localRequire,moduleValue,moduleValue.exports);
const {topN}=moduleValue.exports;
const collator=new Intl.Collator('zh-CN',{numeric:true});
const compare=(a,b)=>Number(b.folder??b.isDirectory())-Number(a.folder??a.isDirectory())||collator.compare(a.name,b.name);
const entries=Array.from({length:200000},(_,index)=>({name:`项目 ${index*48271%200000}`,folder:index%19===0,index}));
entries.splice(17,0,{name:'项目 01',folder:true,index:-1},{name:'项目 1',folder:true,index:-2});

const sortedStart=performance.now();
const expected=entries.slice().sort(compare).slice(0,150);
const sortedMs=performance.now()-sortedStart;
const selectedStart=performance.now();
const actual=topN(entries,150,compare);
const selectedMs=performance.now()-selectedStart;
assert.deepEqual(actual,expected,'Bounded selection must match stable full-directory sorting');
assert.deepEqual(topN([3,1,2],2,(a,b)=>a-b),[1,2]);
assert.deepEqual(topN([3,1,2],0,(a,b)=>a-b),[]);
const report={passed:true,entries:entries.length,shown:150,fullSortMs:Math.round(sortedMs),boundedSelectionMs:Math.round(selectedMs),speedup:Number((sortedMs/selectedMs).toFixed(1))};
const realDirectory=process.env.ONE_TOPN_REAL_DIR||'C:/Windows/WinSxS';
if(fs.existsSync(realDirectory)){
 const directoryEntries=fs.readdirSync(realDirectory,{withFileTypes:true}).filter(entry=>!entry.isSymbolicLink());
 const beforeSort=performance.now(),full=directoryEntries.slice().sort(compare).slice(0,150),realSortMs=performance.now()-beforeSort;
 const beforeTop=performance.now(),bounded=topN(directoryEntries,150,compare),realTopMs=performance.now()-beforeTop;
 assert.deepEqual(bounded.map(entry=>entry.name),full.map(entry=>entry.name));
 report.realDirectory={path:realDirectory,entries:directoryEntries.length,fullSortMs:Math.round(realSortMs),boundedSelectionMs:Math.round(realTopMs)};
}
console.log(JSON.stringify(report));
