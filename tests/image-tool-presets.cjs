const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {build}=require('esbuild');

test('image presets persist validated rules, replace names and reject corrupt entries',async()=>{
 const root=await mkdtemp(join(resolve('work/current'),'image-presets-'));
 try{
  await build({entryPoints:['src/renderer/image-tool-presets.ts'],outdir:root,bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'}});
  const {readImagePresets,saveImagePreset,deleteImagePreset}=require(join(root,'image-tool-presets.cjs'));
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const valid=value=>{if(typeof value?.percent!=='number'||value.percent<1||value.percent>400)throw Error('invalid');return {percent:value.percent};};
  let presets=saveImagePreset(storage,'resize',[],'  半尺寸  ',{percent:50});
  assert.deepEqual(readImagePresets(storage,'resize',valid),[{name:'半尺寸',value:{percent:50}}]);
  presets=saveImagePreset(storage,'resize',presets,'半尺寸',{percent:75});assert.equal(presets.length,1);
  values.set('resize',JSON.stringify([...presets,{name:'损坏',value:{percent:-1}},{name:'半尺寸',value:{percent:10}}]));
  assert.deepEqual(readImagePresets(storage,'resize',valid),[{name:'半尺寸',value:{percent:75}}]);
  assert.deepEqual(deleteImagePreset(storage,'resize',presets,'半尺寸'),[]);
  assert.throws(()=>saveImagePreset(storage,'resize',[],' ',{percent:50}),/名称/);
 }finally{await rm(root,{recursive:true,force:true});}
});
