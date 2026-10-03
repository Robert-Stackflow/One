const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {buildSync}=require('esbuild');

test('file traversal keeps each path once across separate and overlapping selections',async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/current/file-tool-walk');
 await fs.mkdir(out,{recursive:true});
 const bundle=path.join(out,'file-tool-walk.cjs');
 buildSync({entryPoints:['src/main/file-tool-fs.ts'],outfile:bundle,bundle:true,platform:'node',target:'node22'});
 const {walk}=require(bundle),root=await fs.mkdtemp(path.join(out,'selection-'));
 try{
  const parent=path.join(root,'parent'),child=path.join(parent,'child'),peer=path.join(root,'peer');
  await fs.mkdir(child,{recursive:true});await fs.mkdir(peer);
  await Promise.all([fs.writeFile(path.join(parent,'one.txt'),'one'),fs.writeFile(path.join(child,'two.txt'),'two'),fs.writeFile(path.join(peer,'three.txt'),'three')]);
  const collect=async roots=>{const rows=[],issues=[];for await(const item of walk(roots,true,(target,error)=>issues.push({target,error}),true))rows.push(item.path.toLowerCase());assert.deepEqual(issues,[]);return rows;};
  const one=await collect([parent]);
  assert.deepEqual(new Set(one),new Set([parent,child,path.join(parent,'one.txt'),path.join(child,'two.txt')].map(p=>p.toLowerCase())));
  for(const roots of [[parent,child],[child,parent],[parent,parent.toUpperCase()]])assert.deepEqual(new Set(await collect(roots)),new Set(one));
  const separate=await collect([parent,peer]);
  assert.equal(separate.length,6);
  assert.equal(new Set(separate).size,6);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
