const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{buildSync}=require('esbuild');

test('chunked text output matches atomic saving across encodings and split surrogate pairs',async()=>{
 const base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','text-stream-output');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-')),module=path.join(root,'writer.cjs');
 buildSync({entryPoints:['src/main/text-files.ts'],outfile:module,bundle:true,platform:'node',external:['iconv-lite']});
 const {saveText,createTextWriter}=require(module);
 for(const [encoding,parts] of [['UTF-8',['开头','\uD83D','\uDE42 结束']],['UTF-16',['开头','\uD83D','\uDE42 结束']],['GBK',['中文',' 结束']],['Big5',['中文',' 測試']]]){
  const original=path.join(root,encoding+'-original.txt'),target=path.join(root,encoding+'-stream.txt'),events=[];
  await saveText(original,parts.join(''),encoding);await fs.writeFile(target,'OLD');
  const writer=await createTextWriter(target,encoding,value=>events.push(value));
  for(const part of parts)await writer.append(part);
  assert.equal(await fs.readFile(target,'utf8'),'OLD');await writer.finish();
  assert.deepEqual(await fs.readFile(target),await fs.readFile(original));assert.equal(events.length,2);assert.ok(events[0].startsWith(target+'.one-'));assert.equal(events[1],null);
  await assert.rejects(writer.append('closed'),/已关闭/);
 }
 const target=path.join(root,'preserved.txt');await fs.writeFile(target,'OLD');
 const abort=await createTextWriter(target,'UTF-8');await abort.append('未完成');await abort.abort();assert.equal(await fs.readFile(target,'utf8'),'OLD');
 let temporary;const invalid=await createTextWriter(target,'GBK',value=>temporary=value);await assert.rejects(invalid.append('😀'),/无损/);await invalid.abort();assert.equal(await fs.readFile(target,'utf8'),'OLD');assert.equal(temporary,null);
 assert.deepEqual((await fs.readdir(root)).filter(name=>name.includes('.one-')),[]);
});
