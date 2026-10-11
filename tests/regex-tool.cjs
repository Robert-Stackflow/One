const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');

test('regex reports matches, groups and bounded replacement preview',async()=>{
 const outfile=path.resolve('work/current/regex-tool.cjs');await build({entryPoints:['src/shared/regex-tool.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 const {runRegex}=require(outfile);
 const result=runRegex({pattern:'(?<word>[a-z]+)',flags:'gi',text:'Hi 123 HELLO',replacement:'[$<word>]',replace:true});
 assert.deepEqual(result.matches.map(match=>[match.start,match.value,match.groups[0],match.named.word]),[[0,'Hi','Hi','Hi'],[7,'HELLO','HELLO','HELLO']]);
 assert.equal(result.preview,'[Hi] 123 [HELLO]');
 assert.equal(runRegex({pattern:'(?<word>[a-z]+)',flags:'gi',text:'Hi 123 HELLO',replacement:'[$<word>]',replace:true,selectedIndex:1}).preview,'Hi 123 [HELLO]');
 assert.equal(runRegex({pattern:'(?<=a)b',flags:'g',text:'ab ab',replacement:'$`/$&/$\'',replace:true,selectedIndex:1}).preview,'ab aab a/b/');
 assert.equal(runRegex({pattern:'(?=😀)',flags:'gu',text:'😀😀',replacement:'x',replace:true,selectedIndex:1}).preview,'😀x😀');
 assert.equal(runRegex({pattern:'(?=.)',flags:'gu',text:'😀',replacement:'x',replace:false}).matches.length,1);
 assert.deepEqual(runRegex({pattern:'^.',flags:'gm',text:'a\nb',replacement:'',replace:false}).matches.map(match=>match.start),[0,2]);
 assert.equal(runRegex({pattern:'z',flags:'g',text:'a'.repeat(100000),replacement:'',replace:false}).matches.length,0);
 assert.equal(runRegex({pattern:'a',flags:'g',text:'a'.repeat(200),replacement:'x',replace:false}).truncated,true);
 assert.throws(()=>runRegex({pattern:'(',flags:'g',text:'x',replacement:'',replace:false}),/无效/);
 assert.throws(()=>runRegex({pattern:'x',flags:'gg',text:'x',replacement:'',replace:false}),/选项无效/);
 assert.throws(()=>runRegex({pattern:'x',flags:'g',text:'x'.repeat(100001),replacement:'',replace:false}),/输入过长/);
 assert.throws(()=>runRegex({pattern:'x',flags:'g',text:'x',replacement:'',replace:true,selectedIndex:1}),/失效/);
});
