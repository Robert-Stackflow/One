const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {build}=require('esbuild');

const box=(type,body)=>{const head=Buffer.alloc(8);head.writeUInt32BE(body.length+8);head.write(type,4,'ascii');return Buffer.concat([head,body]);};
const fixture=type=>{
 const properties=type===null?Buffer.alloc(0):box('auxC',Buffer.concat([Buffer.alloc(4),Buffer.from(type+'\0')]));
 return Buffer.concat([box('ftyp',Buffer.from('heic0000')),box('meta',Buffer.concat([Buffer.alloc(4),box('iprp',box('ipco',properties))]))]);
};

test('HEIC auxiliary classification rejects unknown or damaged metadata',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'heic-features-'));
 try{
  await build({entryPoints:['src/main/heic-features.ts'],outfile:join(root,'features.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {heicFeatures}=require(join(root,'features.cjs'));
  const file=join(root,'sample.heic');
  await writeFile(file,fixture('urn:com:apple:photo:2020:aux:hdrgainmap'));
  assert.deepEqual(await heicFeatures(file),{hdrGainMap:true,unsupportedAuxiliary:false});
  await writeFile(file,fixture('urn:example:unknown'));
  assert.deepEqual(await heicFeatures(file),{hdrGainMap:false,unsupportedAuxiliary:true});
  await writeFile(file,fixture(null));
  assert.deepEqual(await heicFeatures(file),{hdrGainMap:false,unsupportedAuxiliary:false});
  const damaged=fixture(null);damaged.writeUInt32BE(damaged.length+100,16);
  await writeFile(file,damaged);
  await assert.rejects(()=>heicFeatures(file),/大小无效/);
 }finally{await rm(root,{recursive:true,force:true});}
});
