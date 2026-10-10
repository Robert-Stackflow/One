const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {build}=require('esbuild');
const {parse}=require('yaml');

const ready=(async()=>{
 const outfile=path.resolve('work/current/developer-tools/developer-data.cjs');
 await build({entryPoints:['src/shared/developer-data.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 return require(outfile);
})();

test('JSON formats, compacts, validates and converts to YAML',async()=>{
 const {transformDeveloperData:run}=await ready;
 const source='{"name":"中文 🌄","values":[1,true,null]}';
 assert.match(run({source:'json',action:'format',text:source}).text,/\n  "name"/);
 assert.equal(run({source:'json',action:'compact',text:source}).text,source);
 assert.equal(run({source:'json',action:'validate',text:source}).text,'');
 assert.deepEqual(parse(run({source:'json',action:'convert',text:source}).text),JSON.parse(source));
});

test('YAML conversion preserves values and compact output remains valid YAML',async()=>{
 const {transformDeveloperData:run}=await ready;
 const source='name: 中文 🌄\nitems:\n  - 1\n  - true\n';
 const json=run({source:'yaml',action:'convert',text:source});
 assert.deepEqual(JSON.parse(json.text),{name:'中文 🌄',items:[1,true]});
 assert.deepEqual(parse(run({source:'yaml',action:'compact',text:source}).text),JSON.parse(json.text));
 assert.match(run({source:'yaml',action:'format',text:'# 注释\n'+source}).text,/# 注释/);
});

test('errors identify lines and columns without expanding unsafe aliases',async()=>{
 const {transformDeveloperData:run}=await ready;
 assert.throws(()=>run({source:'json',action:'validate',text:'{\n  "x":,\n}'}),error=>error.line===2&&error.column>=1);
 assert.throws(()=>run({source:'yaml',action:'validate',text:'x: 1\nx: 2'}),error=>error.line===2&&error.column>=1);
 assert.throws(()=>run({source:'yaml',action:'convert',text:'a: &a [1]\nb: *missing'}));
 assert.throws(()=>run({source:'json',action:'format',text:'x'.repeat(5*1024*1024+1)}),/5 MB/);
});
