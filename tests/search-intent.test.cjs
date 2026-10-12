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
test('shortcut activation requires a space and extension unions normalize each member',async()=>{
 const {parseSearchShortcut,validateSearchEngines,searchEngineUrl}=await load('src/shared/search-shortcuts.ts');
 const custom=validateSearchEngines([{id:'custom',shortcut:'site',name:'站内搜索',url:'https://example.com/search?q={query}'}]);
 assert.equal(parseSearchShortcut('g'),null);
 assert.equal(parseSearchShortcut('g ',custom)?.kind,'engine');
 assert.equal(parseSearchShortcut('g ',custom)?.placeholder,'使用 Google 搜索网页');
 assert.equal(parseSearchShortcut('g ',custom)?.showFilters,false);
 assert.equal(parseSearchShortcut('site 中文',custom)?.query,'中文');
 assert.deepEqual(parseSearchShortcut('.zip|.7z ',custom)?.extensions,['zip','7z']);
 assert.equal(parseSearchShortcut('.zip|.7z ',custom)?.placeholder,'搜索 .zip、.7z 文件');
 assert.equal(parseSearchShortcut('.zip|.7z ',custom)?.showFilters,true);
 assert.deepEqual(parseSearchShortcut('.zip|7z 报告',custom)?.extensions,['zip','7z']);
 assert.equal(parseSearchShortcut('.zip| ',custom),null);
 assert.equal(parseSearchShortcut('> ',custom)?.kind,'one');
 assert.equal(parseSearchShortcut('> ',custom)?.showFilters,false);
 assert.equal(searchEngineUrl(custom[0].url,'a b'),'https://example.com/search?q=a%20b');
 assert.throws(()=>validateSearchEngines([{id:'bad',shortcut:'g',name:'冲突',url:'https://example.com/?q={query}'}]));
 assert.throws(()=>searchEngineUrl('http://example.com/?q={query}','a'));
});
