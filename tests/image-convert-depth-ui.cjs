const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {_electron:electron}=require('@playwright/test');
const sharp=require('sharp');
const {png16}=require('./fixtures/png16.cjs');

test('packaged image engine preserves 16-bit PNG in lossless mode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-image-depth-')),source=join(root,'source.png'),out=join(root,'out');
 await mkdir(out);await writeFile(source,png16(4));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);
  const options={format:'png',quality:80,compressionMode:'lossless',preserveMetadata:false,metadataPolicy:'none'};
  const summary=await page.evaluate(({source,out,options})=>window.one.imageConvertStart([source],out,options),{source,out,options});
  assert.equal(summary.results[0].status,'done',summary.results[0].message);
  const output=summary.results[0].output;assert.equal((await sharp(output).metadata()).depth,'ushort');
  assert((await sharp(source).raw({depth:'ushort'}).toBuffer()).equals(await sharp(output).raw({depth:'ushort'}).toBuffer()));
  const rejected=await page.evaluate(({source,out,options})=>window.one.imageConvertStart([source],out,{...options,format:'webp'}),{source,out,options});
  assert.equal(rejected.results[0].status,'error');assert.match(rejected.results[0].message,/位深/);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
