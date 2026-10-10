const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {join,resolve}=require('node:path');
const {mkdirSync,rmSync}=require('node:fs');

test('UUID v4 generation sets version and variant for every requested format',()=>{
 const root=resolve('work/current/developer-uuid-unit');mkdirSync(root,{recursive:true});
 try{
  const output=join(root,'uuid.cjs');buildSync({entryPoints:['src/shared/uuid-tool.ts'],outfile:output,bundle:true,platform:'node',target:'node22'});
  const {generateUuids}=require(output),values=generateUuids(1000,'standard',false);assert.equal(new Set(values).size,1000);
  for(const value of values)assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(generateUuids(1,'compact',true)[0],/^[0-9A-F]{12}4[0-9A-F]{3}[89AB][0-9A-F]{15}$/);
  assert.match(generateUuids(1,'braces',false)[0],/^\{[0-9a-f-]{36}\}$/);
  assert.throws(()=>generateUuids(1001,'standard',false),/数量/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
