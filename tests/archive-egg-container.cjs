const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFile,spawnSync}=require('node:child_process'),{promisify}=require('node:util');const run=promisify(execFile);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),end=Buffer.from('2282e208','hex');
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const extra=(id,data=Buffer.alloc(0),flags=0)=>Buffer.concat([u32(id),Buffer.from([flags]),(flags&1)?u32(data.length):u16(data.length),data]);
const root=(id=1,extras=[])=>Buffer.concat([u32(0x41474745),u16(256),u32(id),u32(0),...extras,end]);
const split=(id,previous,next,bytes,solid=false)=>Buffer.concat([root(id,[extra(0x24f5a262,Buffer.concat([u32(previous),u32(next)])),...(solid?[extra(0x24e5a060)]:[])]),bytes]);
const member=(id,name,size,extras=[],flags=0,aux=Buffer.alloc(0))=>{const bytes=Buffer.from(name);return Buffer.concat([u32(0x0a8590e3),u32(id),u64(size),u32(0x0a8591ac),Buffer.from([flags]),(flags&1)?u32(bytes.length):u16(bytes.length),aux,bytes,...extras,end]);};
const block=(method,expanded,data)=>Buffer.concat([u32(0x02b50c13),Buffer.from([method,0]),u32(expanded),u32(data.length),u32(0),end,data]);
const archive=(contents,extras=[])=>Buffer.concat([root(1,extras),...contents,end]);

async function main(){
 const output=path.resolve('work/archive-build/egg-container'),fixtures=path.resolve('tests/fixtures/archives/egg');await fs.mkdir(output,{recursive:true});
 const manifest=JSON.parse(await fs.readFile(path.join(fixtures,'manifest.json'),'utf8')),sanitizer=process.argv.includes('--asan'),suffix=sanitizer?'-asan':'';
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const found=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true,maxBuffer:4096});
 const installation=found.stdout.trim();assert(installation);const command=path.join(output,'build'+suffix+'.cmd'),probe=path.join(output,'probe'+suffix+'.exe'),env={...process.env};
 if(sanitizer){const versions=(await fs.readdir(path.join(installation,'VC/Tools/MSVC'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const bin=path.join(installation,'VC/Tools/MSVC',versions[0],'bin/Hostx64/x64');await fs.access(path.join(bin,'clang_rt.asan_dynamic-x86_64.dll'));const key=Object.keys(env).find(x=>x.toLowerCase()==='path')||'PATH';env[key]=bin+';'+(env[key]||'');}
 await fs.writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT ${sanitizer?`/O1 /Zi /fsanitize=address /Fd:"${output}/container.pdb"`:'/O2'} /W4 /WX /utf-8 "${path.resolve('native/archive/egg-container.cpp')}" "${path.resolve('tests/archive-egg-container-native.cpp')}" /Fe:"${probe}" /Fo:"${output}/"\r\n`);
 try{const built=await run('cmd.exe',['/d','/c',command],{windowsHide:true,maxBuffer:65536});await fs.writeFile(path.join(output,'build'+suffix+'.log'),built.stdout+built.stderr);}
 catch(error){await fs.writeFile(path.join(output,'build'+suffix+'.log'),(error.stdout||'')+(error.stderr||''));throw Error('EGG container probe build failed; see '+path.join(output,'build'+suffix+'.log'));}
 let checks=0,sequence=0,compared=0;const results=[];
 async function invoke(inputs,{error,memory=256*1024*1024,names=64*1024*1024,entries=1000000,blocks=1000000,cancel=0}={}){
  const paths=[];for(let i=0;i<inputs.length;i++){const input=inputs[i];if(Buffer.isBuffer(input)){const name=path.join(output,'case-'+i+'.egg');await fs.writeFile(name,input);paths.push(name);}else paths.push(input);}
  const result=spawnSync(probe,[String(memory),String(entries),String(blocks),String(names),String(cancel),...paths],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:16384,env});
  assert(!result.error,result.error?.message);assert.equal(result.signal,null);assert.equal(result.status,error?1:0,'case '+sequence+': '+result.stderr);assert(!/AddressSanitizer/.test(result.stderr),result.stderr);
  checks++;sequence++;if(error){assert.match(result.stderr,error);return;}return JSON.parse(result.stdout);
 }
 const project=x=>({name:x.name.replaceAll('\\','/'),size:x.size,encrypted:x.encrypted,method:x.method});
 for(const fixture of manifest.fixtures){const inputs=[path.join(fixtures,fixture.name)],data=await fs.readFile(inputs[0]);assert.equal(data.length,fixture.bytes);assert.equal(hash(data),fixture.sha256);
  if(fixture.name==='number.vol1.egg'){const volume=manifest.additionalVolumes.find(x=>x.name==='number.vol2.egg'),bytes=await fs.readFile(path.join(fixtures,volume.name));assert.equal(bytes.length,volume.bytes);assert.equal(hash(bytes),volume.sha256);inputs.push(path.join(fixtures,volume.name));}
  const actual=await invoke(inputs),expected=fixture.upstreamResult||fixture.result;
  if(expected.entries){assert.deepEqual(actual.entries.map(project),expected.entries.map(project),fixture.name);assert.equal(actual.solid,expected.solid);assert.equal(actual.split,expected.split);checks+=3;compared++;}
  else if(fixture.name==='extattr.egg'){assert.deepEqual(actual.entries.map(x=>[x.name,x.size,x.directory]),[['Somehiddenfile.txt',18,false],['ReadonlyFile.txt',18,false],['test.txt',20,false],['Some folder/',0,true],['testlink',20,false]]);assert(actual.entries[0].attributes&2);assert(actual.entries[1].attributes&1);checks+=3;}
  else{assert.equal(fixture.name,'zeros.egg');assert.equal(actual.entries[0].size,197540460);assert.equal(actual.blocks[0].packed,338);checks+=3;}
  results.push({name:fixture.name,entries:actual.entries.length,solid:actual.solid,split:actual.split,oracleStatus:fixture.oracleStatus});
 }
 // A directory and empty file need no blocks. Multi-block files sum all blocks.
 const directory=extra(0x2c86950b,Buffer.concat([u64(0),Buffer.from([128])])),contents=[member(0,'folder/',0,[directory]),member(1,'empty',0),member(2,'folder/file',4),block(0,2,Buffer.from('ab')),block(0,2,Buffer.from('cd'))];
 const valid=archive(contents),listed=await invoke([valid]);assert.deepEqual(listed.entries.map(x=>[x.size,x.blockCount]),[[0,0],[0,0],[4,2]]);checks++;
 const solid=archive([member(0,'a',2),member(1,'b',2),member(2,'last-dir/',0,[directory]),block(0,2,Buffer.from('ab')),block(0,2,Buffer.from('cd'))],[extra(0x24e5a060)]);
 const solidList=await invoke([solid]);assert.equal(solidList.entries[0].packed,4);assert.equal(solidList.entries[1].blockCount,2);assert.equal(solidList.entries[2].blockCount,0);checks+=3;
 assert.equal((await invoke([archive([])])).entries.length,0);checks++;
 assert.equal((await invoke([archive([member(0,'wide',0,[],1)])])).entries[0].name,'wide');checks++;
 const parent=await invoke([archive([member(0,'dir/',0,[directory]),member(1,'child',0,[],16,u32(0))])]);assert.equal(parent.entries[1].parent,0);assert.equal(parent.entries[1].nameFlags,16);checks+=2;
 const posix=extra(0x1ee922e5,Buffer.concat([u32(0120777),u32(0),u32(0),u64(0)]));assert((await invoke([archive([member(0,'link',0,[posix])])])).entries[0].link);checks++;
 // Encrypt Info outside a File Header belongs to the following entry; the
 // pinned reference constructs a fresh entry on every BuildHeaders call.
 const cipher=extra(0x08d1470f,Buffer.from([1,...Buffer.alloc(20)])),prefix=await invoke([archive([cipher,member(0,'a',0),member(1,'b',0)])]);assert.deepEqual(prefix.entries.map(x=>x.encrypted),[true,false]);checks++;
 const between=await invoke([archive([member(0,'a',0),cipher,member(1,'b',0)])]);assert.deepEqual(between.entries.map(x=>x.encrypted),[false,true]);checks++;
 await invoke([archive([cipher])],{error:/archive:/});await invoke([archive([cipher,cipher,member(0,'a',0)])],{error:/archive:/});
 // Join at arbitrary byte boundaries: even a filename or block header may be
 // split. Volume IDs, not argument order, determine the logical stream.
 const payload=valid.subarray(18);for(const cut of [1,19,payload.length-3]){const first=split(10,0,20,payload.subarray(0,cut)),last=split(20,10,0,payload.subarray(cut));
  const actual=await invoke([last,first]);assert.deepEqual(actual.entries,listed.entries);assert.deepEqual(actual.volumes.map(x=>x.id),[10,20]);checks+=2;
 }
 const first=split(10,0,20,payload.subarray(0,20)),last=split(20,10,0,payload.subarray(20));
 await invoke([first],{error:/volumes:/});await invoke([last],{error:/archive:/});await invoke([first,first],{error:/archive:/});
 await invoke([first,split(20,99,0,payload.subarray(20))],{error:/archive:/});await invoke([first,last,split(30,40,0,Buffer.alloc(0))],{error:/Unrelated/});
 await invoke([valid,valid],{error:/archive:/});await invoke([first,split(20,10,0,payload.subarray(20),true)],{error:/archive:/});
 await invoke([split(1,0,2,Buffer.alloc(0)),split(2,1,3,Buffer.alloc(0)),split(3,2,4,Buffer.alloc(0)),split(4,3,2,payload)],{error:/cycle/});
 const short=await fs.readFile(path.join(fixtures,'azoshort_txt.egg'));for(let size=0;size<short.length;++size)await invoke([short.subarray(0,size)],{error:/archive:/});
 const malformed=[archive([member(0,'',0)]),archive([member(0,'x\0y',0)]),archive([member(0,'secret',0,[],4)]),archive([member(0,'bad-flags',0,[],32)]),
  archive([member(0,'a',0),member(0,'b',0)]),archive([member(0,'wrong-size',3),block(0,2,Buffer.from('ab'))]),archive([block(0,0,Buffer.alloc(0))]),
  archive([member(0,'directory/',0,[directory]),block(0,0,Buffer.alloc(0))]),archive([member(0,'unknown-method',0),block(5,0,Buffer.alloc(0))]),
  archive([member(0,'stored-size',3),block(0,3,Buffer.from('ab'))]),archive([member(0,'a',0,[extra(0x0a8591ac,Buffer.from('second'))])]),
  archive([member(0,'a',0,[extra(0x2c86950b,Buffer.alloc(8))])]),archive([member(0,'a',0,[extra(0x08d1470f,Buffer.from([3,...Buffer.alloc(20)]))])]),
  archive([member(0,'a',0,[extra(0x08d1470f,Buffer.alloc(10))])]),archive([member(0,'a',0,[extra(0x12345678)])]),archive([],[extra(0x12345678)]),
  archive([],[extra(0x24e5a060),extra(0x24e5a060)]),Buffer.concat([valid,Buffer.from([0])])];
 for(const data of malformed)await invoke([data],{error:/archive:|safety:/});
 await invoke([archive([member(0,'huge',9007199254740992n)])],{error:/resource:/});
 await invoke([valid],{memory:1,error:/resource:/});await invoke([valid],{entries:2,error:/resource:/});await invoke([valid],{blocks:1,error:/resource:/});await invoke([valid],{names:5,error:/resource:/});
 await invoke([valid],{cancel:5,error:/cancelled:/});
 const zeros=await invoke([path.join(fixtures,'zeros.egg')],{memory:64*1024});assert.equal(zeros.entries[0].size,197540460);checks++;
 await fs.writeFile(path.join(output,'results'+suffix+'.json'),JSON.stringify({date:new Date().toISOString(),referenceCommit:manifest.commit,checks,sanitizer,comparedDatasets:compared,results,scope:'Container metadata only; payload CRC/crypto/product entry points pending'},null,2)+'\n');
 console.log(`EGG C++ container passed${sanitizer?' (AddressSanitizer)':''}: ${checks} checks, ${compared} reference metadata datasets, attributes/output-limit metadata, multiple blocks, solid streams, volume ordering/boundaries, truncation, memory/count limits and cancellation. Product integration pending.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
