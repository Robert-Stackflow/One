const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const bundle=buildSync({entryPoints:['src/shared/text.ts'],bundle:true,platform:'node',format:'cjs',external:['opencc-js'],write:false}).outputFiles[0].text;
function load(Converter){const sandbox={module:{exports:{}},exports:null,require:name=>{assert.equal(name,'opencc-js');return{Converter};}};sandbox.exports=sandbox.module.exports;vm.runInNewContext(bundle,sandbox);return sandbox.module.exports.transform;}
test('ordinary text tools remain available without constructing conversion dictionaries',()=>{
 const transform=load(()=>{throw Error('dictionary construction unavailable');});
 assert.equal(transform({operation:'clean',text:' 甲 \r\n\r 乙 '}),'甲\r\n乙');assert.equal(transform({operation:'unique',text:'甲\n乙\n甲'}),'甲\r\n乙');assert.equal(transform({operation:'upper',text:'abc🙂'}),'ABC🙂');assert.equal(transform({operation:'normalize',text:'e\u0301'}),'é');
 assert.throws(()=>transform({operation:'traditional',text:'台湾'}),/dictionary construction unavailable/);assert.equal(transform({operation:'half',text:'ＡＢＣ　'}),'ABC ');
});
test('conversion initialization retries after failure and reuses each direction across a workflow',()=>{
 const calls=[];let failing=true;const transform=load(options=>{calls.push([options.from,options.to]);if(failing)throw Error('temporary failure');return text=>`${options.from}>${options.to}:${text}`;});
 assert.throws(()=>transform({operation:'simple',text:'甲'}),/temporary failure/);failing=false;
 assert.equal(transform({operation:'simple',text:'甲'}),'twp>cn:甲');assert.equal(transform({operation:'simple',text:'乙'}),'twp>cn:乙');assert.equal(transform({operation:'traditional',text:'丙'}),'cn>twp:丙');assert.equal(transform({operation:'traditional',text:'丁'}),'cn>twp:丁');assert.equal(transform({operation:'simple',text:'戊'}),'twp>cn:戊');assert.deepEqual(calls,[['twp','cn'],['twp','cn'],['cn','twp']]);
});
