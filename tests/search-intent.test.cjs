const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
async function load(file){const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(m,m.exports,require);return m.exports;}
test('dot extensions search files while preserving explicit folder and quoted queries',async()=>{
 const {searchMatcher}=await load('src/shared/search.ts');
 const file=(name)=>({path:'D:\\Documents\\'+name,name,directory:false,size:0,modified:0}),folder=(name)=>({...file(name),directory:true});
 assert.ok(searchMatcher('.zip')(file('report.zip'))>=0);
 assert.equal(searchMatcher('.zip')(folder('.zip')),-1);
 assert.equal(searchMatcher('.zip')(folder('zip projects')),-1);
 assert.ok(searchMatcher('report .png')(file('report.png'))>=0);
 assert.ok(searchMatcher('*.7z')(file('backup.7z'))>=0);
 assert.equal(searchMatcher('report .png')(file('report.zip')),-1);
 assert.ok(searchMatcher('folder: .zip')(folder('.zip'))>=0);
 assert.ok(searchMatcher('".zip"')(folder('.zip'))>=0);
});
test('One commands match Chinese, full pinyin, initials and a small pinyin typo',async()=>{
 const {commandMatches}=await load('src/renderer/search-commands.ts');
 for(const query of ['文件搜索','wenjiansousuo','wjss','wenjainsousuo'])
  assert.equal(commandMatches(query)[0]?.path,'action:page:search',query);
 assert.equal(commandMatches('kongjianfenxi')[0]?.path,'action:disk');
 assert.equal(commandMatches('port')[0]?.path,'action:page:ports');
 assert.equal(commandMatches('wenjiansousuo',6,{pinyin:false,fuzzy:true}).length,0);
 assert.equal(commandMatches('wenjainsousuo',6,{pinyin:true,fuzzy:false}).length,0);
});
