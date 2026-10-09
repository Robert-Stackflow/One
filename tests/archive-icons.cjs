const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {crc32}=require('node:zlib');
const {promisify}=require('node:util');
const {build}=require('esbuild');
const {spawnSync}=require('node:child_process');

async function main(){
 const {formats,sizes}=await import('../scripts/export-archive-icons.mjs');
 const requested='zip zipx rar 7z alz egg cab bh 001 arj lha lzh pma ace arc aes zpaq zstd br tar gz tgz bz bz2 tbz tbz2 xz txz lzma tlz lz z jar war apk ipa xpi iso img isz udf wim bin i00'.split(' ');
 for(const name of requested)assert(formats.some(format=>format[0]===name),'Missing requested format icon: '+name);
 const hashes=new Set();
 for(const [name] of formats){
  const bytes=await fs.readFile(path.resolve('assets/icons/archive',name+'.ico'));
  assert.equal(bytes.readUInt16LE(0),0);assert.equal(bytes.readUInt16LE(2),1);assert.equal(bytes.readUInt16LE(4),sizes.length);
  let offset=6+16*sizes.length;
  for(let index=0;index<sizes.length;index++){
   const entry=6+16*index,size=sizes[index];assert.equal(bytes[entry]||256,size);assert.equal(bytes[entry+1]||256,size);
   assert.equal(bytes.readUInt16LE(entry+4),1);assert.equal(bytes.readUInt16LE(entry+6),32);assert.equal(bytes.readUInt32LE(entry+12),offset);
   const length=bytes.readUInt32LE(entry+8),png=bytes.subarray(offset,offset+length);offset+=length;
   if(size<256){assert.equal(png.readUInt32LE(0),40);assert.equal(png.readInt32LE(4),size);assert.equal(png.readInt32LE(8),size*2);assert.equal(png.readUInt16LE(14),32);assert.equal(png[40+(size-1)*size*4+3],0,'Transparent DIB corner');assert.equal(length,40+size*size*4+Math.ceil(size/32)*4*size);continue;}
   assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
   assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.equal(png[25],6,'RGBA transparency');
   let cursor=8;while(cursor<png.length){const count=png.readUInt32BE(cursor),end=cursor+8+count;assert(end+4<=png.length);assert.equal(crc32(png.subarray(cursor+4,end)),png.readUInt32BE(end));cursor=end+4;}
   assert.equal(cursor,png.length);
  }
  assert.equal(offset,bytes.length);hashes.add(createHash('sha256').update(bytes).digest('hex'));
 }
 assert.equal(hashes.size,formats.length,'Each format has distinct artwork');
 const config=JSON.parse(await fs.readFile('package.json','utf8'));
 assert(config.build.asarUnpack.includes('dist/icons/archive/*.ico'),'Windows needs physical ICO files outside asar');
 // Exercise actual asar unpacking and the production PowerShell implementation
 // without touching real associations or launching Explorer.
 await fs.mkdir('work/temp',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-icons-'));
 try{
  const folder=path.join(root,'package','dist','icons','archive');await fs.mkdir(folder,{recursive:true});
  for(const [name] of formats)await fs.copyFile(path.resolve('assets/icons/archive',name+'.ico'),path.join(folder,name+'.ico'));
  const asar=require('@electron/asar'),archive=path.join(root,'app.asar');
  // The low-level asar library matches absolute names; electron-builder's
  // asarUnpack matcher applies the same configured pattern relative to appDir.
  await asar.createPackageWithOptions(path.join(root,'package'),archive,{unpack:'**/dist/icons/archive/*.ico'});
  for(const [name] of formats){const entry=path.join('dist','icons','archive',name+'.ico');assert.equal(asar.statFile(archive,entry).unpacked,true);assert.deepEqual(await fs.readFile(path.join(archive+'.unpacked',entry)),await fs.readFile(path.resolve('assets/icons/archive',name+'.ico')));}
  const script=path.join(root,'archive-associations.ps1');await fs.writeFile(script,Buffer.concat([Buffer.from([239,187,191]),await fs.readFile('src/main/archive-associations.ps1')]));
  const tested=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/archive-associations.ps1'),'-Source',script],{encoding:'utf8',windowsHide:true});assert.equal(tested.status,0,tested.stdout+'\n'+tested.stderr);console.log(tested.stdout.trim());
 }finally{assert(path.dirname(root)===path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});}
 const bundled=await build({entryPoints:['src/main/archive-associations.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
 const calls=[],external=[];
 const execute=()=>{throw Error('Unexpected native execution');};execute[promisify.custom]=async(...args)=>{calls.push(args);return {stdout:'{"registered":true}'};};
 const module={exports:{}};
 vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,process:{execPath:'D:\\Program Files\\One 测试\\One.exe'},__dirname:'D:\\Program Files\\One 测试\\resources\\app.asar\\dist\\main',require:name=>name==='electron'?{app:{isPackaged:true},shell:{openExternal:async url=>external.push(url)}}:name==='node:child_process'?{execFile:execute}:require(name)});
 for(const operation of ['status','register','remove','defaults'])await module.exports.archiveAssociation(operation);
 for(const [,args] of calls){assert.equal(args[args.indexOf('-IconDirectory')+1],'D:\\Program Files\\One 测试\\resources\\app.asar.unpacked\\dist\\icons\\archive');assert.equal(args[args.indexOf('-Executable')+1],'D:\\Program Files\\One 测试\\One.exe');}
 assert.equal(external.length,1);assert(external[0].startsWith('ms-settings:defaultapps?'));
 console.log(`Archive icon checks passed: ${formats.length} distinct icons, ${sizes.length} DIB/PNG frames each, unpacked resource paths and all association operations.`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
