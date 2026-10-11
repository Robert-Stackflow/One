const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {join,resolve}=require('node:path');
const {mkdirSync,rmSync}=require('node:fs');

test('UUID v3/v5 match RFC 9562 vectors and v4/v7 preserve variant, order and formatting',()=>{
 const root=resolve('work/current/developer-uuid-unit');mkdirSync(root,{recursive:true});
 try{
  const output=join(root,'uuid.cjs');buildSync({entryPoints:['src/shared/uuid-tool.ts'],outfile:output,bundle:true,platform:'node',target:'node22'});
  const {generateUuids}=require(output),v4={version:'v4',count:1000,format:'standard',uppercase:false},values=generateUuids(v4);assert.equal(new Set(values).size,1000);
  for(const value of values)assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const named={count:1,format:'standard',uppercase:false,name:'www.example.com',namespace:'dns'};
  assert.equal(generateUuids({...named,version:'v3'})[0],'5df41881-3aed-3515-88a7-2f4a814cf09e');
  assert.equal(generateUuids({...named,version:'v5'})[0],'2ed6657d-e927-568b-95e1-2665a8aea6a2');
  assert.equal(generateUuids({...named,version:'v5',namespace:'custom',customNamespace:'6BA7B810-9DAD-11D1-80B4-00C04FD430C8'})[0],generateUuids({...named,version:'v5'})[0]);
  const before=Date.now(),v7=generateUuids({version:'v7',count:1000,format:'standard',uppercase:false}),after=Date.now();assert.equal(new Set(v7).size,1000);
  for(let i=0;i<v7.length;i++){const value=v7[i],time=parseInt(value.slice(0,8)+value.slice(9,13),16);assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert(time>=before&&time<=after);if(i)assert(v7[i]>v7[i-1]);}
  const next=generateUuids({version:'v7',count:1,format:'standard',uppercase:false})[0];assert(next>v7.at(-1));
  const clock=Date.now;try{Date.now=()=>before-1;assert(generateUuids({version:'v7',count:1,format:'standard',uppercase:false})[0]>next);}finally{Date.now=clock;}
  assert.match(generateUuids({...v4,count:1,format:'compact',uppercase:true})[0],/^[0-9A-F]{12}4[0-9A-F]{3}[89AB][0-9A-F]{15}$/);
  assert.match(generateUuids({...named,version:'v5',format:'braces',uppercase:true})[0],/^\{[0-9A-F-]{36}\}$/);
  assert.throws(()=>generateUuids({...v4,count:1001}),/数量/);
  assert.throws(()=>generateUuids({...named,version:'v5',name:''}),/名称/);
  assert.throws(()=>generateUuids({...named,version:'v3',namespace:'custom',customNamespace:'not-a-uuid'}),/命名空间/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
