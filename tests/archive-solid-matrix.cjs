const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
const execute=promisify(execFile),hash=data=>crypto.createHash('sha256').update(data).digest('hex'),password='固实🔐 test 密码';
async function fileHash(file){const digest=crypto.createHash('sha256');for await(const bytes of require('node:fs').createReadStream(file))digest.update(bytes);return digest.digest('hex');}
async function external(exe,args,cwd){try{return await execute(exe,args,{cwd,windowsHide:true,encoding:'utf8',maxBuffer:128*1024,timeout:120000});}catch(error){throw Object.assign(Error('External 7-Zip failed: '+String(error.stdout||error.stderr||error).slice(-1200)),{exitCode:error.code});}}
function technical(text){const sections=text.replaceAll('\r','').split(/\n\n+/),values=section=>Object.fromEntries(section.split('\n').filter(line=>line.includes(' = ')).map(line=>{const at=line.indexOf(' = ');return [line.slice(0,at),line.slice(at+3)];}));const all=sections.map(values);return {archive:all.find(value=>value.Type==='7z'),entries:all.filter(value=>value.Block!==undefined)};}
async function main(){
 const writer=path.resolve(process.argv[2]||''),directory=path.resolve(process.argv[3]||'work/current/archive-solid-matrix'),relative=path.relative(path.resolve('work/current'),directory);assert(process.argv[2],'Provide official 7z.exe path');assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Fixture root must be a fresh child of work/current');
 const resume=process.argv.includes('--resume-budget-check');if(!resume)assert(!await fs.stat(directory).catch(()=>null),'Refuse existing matrix directory');await fs.mkdir(directory,{recursive:true});
 const input=path.join(directory,'input');if(!resume)await fs.mkdir(input);const version=(await external(writer,['i'])).stdout.match(/7-Zip[^\r\n]*/)?.[0];assert(version);
 const fixture=resume?JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')):{version,writerSha256:await fileHash(writer),expected:[],cases:[],oneCreated:[],errors:[]};let service,root;
 if(resume){assert.equal(fixture.writerSha256,await fileHash(writer));assert.equal(fixture.cases.length,54);assert.equal(fixture.oneCreated.length,12);assert(fixture.cases.every(item=>item.verified===8&&item.error?.includes('声明展开量超过本次解压上限')));assert(fixture.oneCreated.every(item=>item.passed&&item.verified===4));await fs.copyFile(path.join(directory,'manifest.json'),path.join(directory,'manifest-before-budget-fix.json'),require('node:fs').constants.COPYFILE_EXCL);fixture.reusedPositiveChecks=480;fixture.initialTestSha256=await fileHash(path.join(directory,'first-attempt.cjs'));fixture.errors=[];}
 try{
  for(const [name,bytes] of resume?[]:[['00-first.bin',4*1024**2],['10-prefix.bin',17*1024**2],['20-suffix.bin',4*1024**2],['99-tail.txt',1024]]){
   const handle=await fs.open(path.join(input,name),'wx'),digest=crypto.createHash('sha256'),block=Buffer.alloc(1024**2);let seed=crypto.createHash('sha256').update(name).digest();for(let i=0;i<32768;i+=32){seed=crypto.createHash('sha256').update(seed).digest();seed.copy(block,i);}for(let i=32768;i<block.length;i+=32768)block.copy(block,i,0,32768);
   try{for(let offset=0;offset<bytes;offset+=block.length){block.writeUInt32LE(offset/block.length,0);const part=block.subarray(0,Math.min(block.length,bytes-offset));digest.update(part);await handle.write(part);}}finally{await handle.close();}
   fixture.expected.push({name,bytes,sha256:digest.digest('hex')});
  }
  await fs.mkdir('work/temp',{recursive:true});root=await fs.mkdtemp(path.resolve('work/temp/one-solid-matrix-'));
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/archive-solid-matrix-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  let currentProgress=[];service=new mod.exports.ArchiveService(path.join(root,'cache'),(_owner,event)=>{if(event.operation==='extract')currentProgress.push({done:event.done,total:event.total});},()=> '0',()=>{},false,undefined,()=>({threads:1,memoryMiB:256}));
  const run=request=>service.run(1,{threads:1,memoryMiB:256,...request});
  const extract=async(archive,secret,listing,selected,label,limits)=>{
   const parent=path.join(root,label);await fs.mkdir(parent);currentProgress=[];
   try{const result=await run({operation:'extract',path:archive,parent,password:secret,selected,revision:listing.revision,extractionLimits:limits,propagateZone:false});assert(result.path&&!result.risk);
    const expected=selected?fixture.expected.filter((_,index)=>selected.includes(index)):fixture.expected;
    for(const entry of expected)assert.equal(await fileHash(path.join(result.path,entry.name)),entry.sha256,label+' '+entry.name);
    const names=(await fs.readdir(result.path)).sort();assert.deepEqual(names,expected.map(item=>item.name).sort());const progress=currentProgress.filter(value=>value.total>0);assert(progress.every(value=>value.total===expected.length&&value.done<=expected.length));assert.equal(progress.at(-1)?.done,expected.length);
    return expected.length;
   }finally{await fs.rm(parent,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  };
  let counter=0;
  for(const method of ['LZMA','LZMA2'])for(const dictionaryMiB of [1,8,16])for(const solid of ['off',8,64])for(const encryption of ['none','data','headers']){
   const name=`external-${method.toLowerCase()}-${dictionaryMiB}-${solid}-${encryption}.7z`,archive=path.join(directory,name),secret=encryption==='none'?'':password,record=resume?fixture.cases.find(item=>item.name===name):{name,method,dictionaryMiB,solid,encryption,verified:0};if(!resume)fixture.cases.push(record);else{assert.equal(await fileHash(archive),record.archiveSha256);delete record.error;}
   try{
    if(!resume){await external(writer,['a','-t7z','-mx=1',`-m0=${method}:d=${dictionaryMiB}m`,'-mmt=1',`-ms=${solid==='off'?'off':solid+'m'}`,'-mqs=off',...(secret?['-p'+secret,'-mhe='+(encryption==='headers'?'on':'off')]:[]),'-bso0','-bsp0',archive,...fixture.expected.map(item=>item.name)],input);
    record.archiveSha256=await fileHash(archive);record.archiveBytes=(await fs.stat(archive)).size;
    const detail=technical((await external(writer,['l','-slt',...(secret?['-p'+secret]:[]),archive])).stdout);assert(detail.archive);record.observed={method:detail.archive.Method,solid:detail.archive.Solid,blocks:Number(detail.archive.Blocks),entryBlocks:detail.entries.map(item=>Number(item.Block))};
    assert.match(detail.archive.Method,new RegExp('^'+method+':'+Math.log2(dictionaryMiB*1024**2)+'(?:\\s|$)'));assert.equal(detail.archive.Blocks,solid==='off'?'4':solid===8?'3':'1');assert.deepEqual(record.observed.entryBlocks,solid==='off'?[0,1,2,3]:solid===8?[0,1,2,2]:[0,0,0,0]);assert.deepEqual(detail.entries.map(item=>item.Path),fixture.expected.map(item=>item.name));
    await external(writer,['t','-y','-bso0','-bsp0',...(secret?['-p'+secret]:[]),archive]);}
    const listing=await run({operation:'list',path:archive,password:secret});assert.equal(listing.total,4);assert.deepEqual(listing.entries.map(item=>item.name),fixture.expected.map(item=>item.name));assert(listing.entries.every(item=>item.encrypted===!!secret));
    if(!resume){if(encryption==='headers')await assert.rejects(run({operation:'list',path:archive}),error=>['password','archive'].includes(error.code));
    await run({operation:'test',path:archive,password:secret});
    record.verified+=await extract(archive,secret,listing,[3],name+'-tail');record.verified+=await extract(archive,secret,listing,[0,3],name+'-sparse');record.verified+=await extract(archive,secret,listing,undefined,name+'-full');record.verified+=await extract(archive,secret,listing,[3],name+'-budget',{maxBytes:1024,maxMilliseconds:60000});}
    const failed=path.join(root,name+'-failed');await fs.mkdir(failed);try{
     await assert.rejects(run({operation:'extract',path:archive,parent:failed,password:secret,selected:[3],revision:listing.revision,extractionLimits:{maxBytes:512,maxMilliseconds:60000}}),error=>error.code==='safety');assert.deepEqual(await fs.readdir(failed),[]);
     if(secret){let wrong;await assert.rejects(run({operation:'extract',path:archive,parent:failed,password:'incorrect-test-password',selected:[3],revision:listing.revision}),error=>{wrong=error.code;return ['password','archive'].includes(error.code);});record.wrongPasswordCode=wrong;assert.deepEqual(await fs.readdir(failed),[]);}
    }finally{await fs.rm(failed,{recursive:true,force:true});}
    const damaged=path.join(root,name+'-damaged.7z'),data=await fs.readFile(archive);assert(data.length>8192);data[32+4096]^=0x80;await fs.writeFile(damaged,data);
    await assert.rejects(run({operation:'test',path:damaged,password:secret}),error=>['archive','password'].includes(error.code));
    const badListing=await run({operation:'list',path:damaged,password:secret});
    if(solid===64){const bad=path.join(root,name+'-corrupted');await fs.mkdir(bad);try{await assert.rejects(run({operation:'extract',path:damaged,parent:bad,password:secret,selected:[3],revision:badListing.revision}),error=>['archive','password'].includes(error.code));assert.deepEqual(await fs.readdir(bad),[]);}finally{await fs.rm(bad,{recursive:true,force:true});}record.corruptPrefix='selected block rejected';}
    else{record.verified+=await extract(damaged,secret,badListing,[3],name+'-separate-block');record.corruptPrefix='unselected block does not prevent intact selected block';}
    await fs.rm(damaged);assert.equal(await fileHash(archive),record.archiveSha256);record.passed=true;
   }catch(error){record.error=String(error.stack||error).slice(-1600);fixture.errors.push({name,error:record.error});throw error;}
   await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(fixture,null,2)+'\n');if(++counter%6===0)console.log('External matrix '+counter+'/54; failures '+fixture.errors.length);
  }
  if(resume)for(const record of fixture.oneCreated)assert.equal(await fileHash(path.join(directory,record.name)),record.archiveSha256);
  for(const method of resume?[]:['lzma','lzma2'])for(const solid of ['off',8,64])for(const encrypted of [false,true]){
   const name=`one-${method}-${solid}-${encrypted?'headers':'none'}.7z`,archive=path.join(directory,name),secret=encrypted?password:'',record={name,method,solid,encrypted,verified:0};fixture.oneCreated.push(record);
   try{
    await run({operation:'create',path:archive,sources:fixture.expected.map(item=>path.join(input,item.name)),sevenMethod:method,sevenSolid:solid,password:secret,level:1,memoryMiB:512});
    const info=technical((await external(writer,['l','-slt',...(secret?['-p'+secret]:[]),archive])).stdout);assert.equal(info.archive.Blocks,solid==='off'?'4':solid===8?'3':'1');assert.match(info.archive.Method,new RegExp('^'+method.toUpperCase()+'(?::|\\s|$)'));record.observed=info.archive;
    await external(writer,['t','-y','-bso0','-bsp0',...(secret?['-p'+secret]:[]),archive]);if(encrypted)await assert.rejects(external(writer,['l','-slt','-pincorrect-test-password',archive]),error=>error.exitCode===2);const listing=await run({operation:'list',path:archive,password:secret});assert(listing.entries.every(item=>item.encrypted===encrypted));await run({operation:'test',path:archive,password:secret});record.verified+=await extract(archive,secret,listing,undefined,name+'-full');record.archiveSha256=await fileHash(archive);record.passed=true;
   }catch(error){record.error=String(error.stack||error).slice(-1600);fixture.errors.push({name,error:record.error});throw error;}
   await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(fixture,null,2)+'\n');
  }
  fixture.outputHashChecks=[...fixture.cases,...fixture.oneCreated].reduce((sum,item)=>sum+item.verified,0);assert.equal(fixture.errors.length,0,JSON.stringify(fixture.errors.map(item=>({name:item.name,error:item.error.slice(-500)}))).slice(0,2500));
  console.log('Solid configuration matrix passed: 54 independent archives, 12 One creations, '+fixture.outputHashChecks+' output hashes, exact sparse progress, budgets, passwords and solid-block corruption isolation.');
 }finally{
  await service?.stop();if(root){const actual=await fs.realpath(root),base=await fs.realpath('work/temp'),relative=path.relative(base,actual);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  if(!resume){const actual=await fs.realpath(input),base=await fs.realpath(directory);assert.equal(path.dirname(actual),base);assert(!(await fs.lstat(input)).isSymbolicLink());for(const entry of await fs.readdir(input)){assert(fixture.expected.some(item=>item.name===entry));assert((await fs.lstat(path.join(input,entry))).isFile());}await fs.rm(input,{recursive:true,force:true});}
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(fixture,null,2)+'\n');
 }
}
main().catch(error=>{console.error(String(error.stack||error).slice(-3000));process.exitCode=1;});
