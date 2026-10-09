const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFile,spawnSync}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),hash=b=>crypto.createHash('sha256').update(b).digest('hex');

// Trusted, hashed non-solid corpus only. Walk framing instead of searching for
// magic bytes inside compressed contents; this is not the production parser.
function azoBlocks(data){
 assert.equal(data.readUInt32LE(0),0x41474745);assert.equal(data.readUInt16LE(4),256);let p=14;const blocks=[];
 function extras(){while(p<data.length){assert(p+4<=data.length);const sig=data.readUInt32LE(p);p+=4;if(sig===0x08e28222)return;
  assert(p+3<=data.length);const flags=data[p++],wide=(flags&1)!==0;assert(p+(wide?4:2)<=data.length);
  const size=wide?data.readUInt32LE(p):data.readUInt16LE(p);p+=(wide?4:2);assert(size<=data.length-p);p+=size;
 }assert.fail('Missing header terminator');}
 extras();while(p<data.length){assert(p+4<=data.length);const sig=data.readUInt32LE(p);p+=4;
  if(sig===0x0a8590e3){assert(p+12<=data.length);p+=12;extras();}
  else if(sig===0x02b50c13){assert(p+14<=data.length);assert.equal(data[p],3);const expanded=data.readUInt32LE(p+2),packed=data.readUInt32LE(p+6);p+=14;extras();
   assert(packed<=data.length-p);blocks.push({expanded,data:data.subarray(p,p+packed)});p+=packed;
  }else{assert.equal(sig,0x08e28222);assert.equal(p,data.length);}
 }return blocks;
}
function header(expanded,packed){const data=Buffer.alloc(12);data.writeUInt32BE(expanded);data.writeUInt32BE(packed,4);data.writeUInt32BE((expanded^packed)>>>0,8);return data;}
const stored=(bytes,filter=0)=>Buffer.concat([Buffer.from([0x31,filter]),header(bytes.length,bytes.length),bytes,Buffer.alloc(12)]);

async function main(){
 const root=path.resolve('work/archive-build/egg-codecs');await fs.mkdir(root,{recursive:true});
 const fixtureRoot=path.resolve('tests/fixtures/archives/egg'),manifest=JSON.parse(await fs.readFile(path.join(fixtureRoot,'manifest.json'),'utf8'));
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const found=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true,maxBuffer:4096});
 const installation=found.stdout.trim();assert(installation);const sanitizer=process.argv.includes('--asan'),suffix=sanitizer?'-asan':'';
 const command=path.join(root,'build-azo'+suffix+'.cmd'),probe=path.join(root,'azo-probe'+suffix+'.exe'),env={...process.env};
 if(sanitizer){const versions=(await fs.readdir(path.join(installation,'VC/Tools/MSVC'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const bin=path.join(installation,'VC/Tools/MSVC',versions[0],'bin/Hostx64/x64');await fs.access(path.join(bin,'clang_rt.asan_dynamic-x86_64.dll'));
  const key=Object.keys(env).find(x=>x.toLowerCase()==='path')||'PATH';env[key]=bin+';'+(env[key]||'');
 }
 await fs.writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT ${sanitizer?'/O1 /Zi /fsanitize=address':'/O2'} /W4 /WX /utf-8 "${path.resolve('native/archive/egg-azo.cpp')}" "${path.resolve('tests/archive-egg-azo-native.cpp')}" /Fe:"${probe}" /Fo:"${root}/"\r\n`);
 try{const built=await run('cmd.exe',['/d','/c',command],{windowsHide:true,maxBuffer:65536});await fs.writeFile(path.join(root,'build.log'),built.stdout+built.stderr);}
 catch(error){await fs.writeFile(path.join(root,'build.log'),(error.stdout||'')+(error.stderr||''));throw Error('AZO probe build failed; see '+path.join(root,'build.log'));}
 let checks=0,sequence=0;const results=[],rawBlocks=[];
 async function invoke(data,expected,{error,budget=64*1024*1024,cancel=0}={}){
  const input=path.join(root,'case.azo'),output=path.join(root,'case.out');await fs.writeFile(input,data);
  const result=spawnSync(probe,[input,output,String(expected),String(budget),String(cancel)],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:4096,env});
  assert(!result.error,result.error?.message);assert.equal(result.signal,null);assert.equal(result.status,error?1:0,'case '+sequence+': '+result.stderr);
  if(error){assert.match(result.stderr,error);checks++;sequence++;return fs.readFile(output);}
  const bytes=await fs.readFile(output);assert.equal(bytes.length,expected);checks++;sequence++;return bytes;
 }
 for(const name of ['azoshort_txt.egg','azonumbers.egg','azomulti.egg']){
  const fixture=manifest.fixtures.find(x=>x.name===name);assert(fixture);const data=await fs.readFile(path.join(fixtureRoot,name));assert.equal(data.length,fixture.bytes);assert.equal(hash(data),fixture.sha256);
  const blocks=azoBlocks(data);assert.equal(blocks.length,fixture.result.entries.length);
  for(let i=0;i<blocks.length;++i){const b=blocks[i],entry=fixture.result.entries[i],bytes=await invoke(b.data,b.expanded);assert.equal(hash(bytes),entry.sha256);checks++;
   rawBlocks.push({...b,sha256:entry.sha256});results.push({name,entry:entry.name,bytes:bytes.length,sha256:hash(bytes)});
  }
 }
 // Model state must restart on every inner block, even within one EGG block.
 const joined=Buffer.concat([Buffer.from([0x31,0]),...rawBlocks.map(b=>b.data.subarray(2,-12)),Buffer.alloc(12)]);
 const joinedBytes=await invoke(joined,rawBlocks.reduce((n,b)=>n+b.expanded,0));let offset=0;
 for(const b of rawBlocks){assert.equal(hash(joinedBytes.subarray(offset,offset+b.expanded)),b.sha256);offset+=b.expanded;checks++;}
 assert.equal((await invoke(Buffer.from([0x31,0,...Buffer.alloc(12)]),0,{budget:0})).length,0);
 assert.deepEqual(await invoke(stored(Buffer.from('stored AZO block')),16),Buffer.from('stored AZO block'));checks++;
 // Published CC0 A.12 address vectors; the MIT oracle ignores this filter flag.
 const filtered=Buffer.from('90e810000000e9000000ff90e800000002e801000000', 'hex');
 const expected=Buffer.from('90e80f000000e9faffff0090e800000002e8f0ffffff','hex');
 assert.deepEqual(await invoke(stored(filtered,1),filtered.length),expected);checks++;
 const original=rawBlocks[0].data;
 for(let size=0;size<original.length;++size)await invoke(original.subarray(0,size),128,{error:/archive:/});
 for(const [at,value] of [[0,0x30],[1,2],[10,original[10]^1]]){const data=Buffer.from(original);data[at]=value;await invoke(data,128,{error:/archive:/});}
 await invoke(original,127,{error:/archive:/});await invoke(original,129,{error:/archive:/});
 await invoke(Buffer.concat([original,Buffer.from([1])]),128,{error:/Trailing test input/});
 await invoke(original,128,{budget:128+78+1024*1024-1,error:/resource:/});
 const malformed=(expanded,packed)=>Buffer.concat([Buffer.from([0x31,0]),header(expanded,packed)]);
 for(const [expanded,packed] of [[0,1],[1,0],[1,2]])await invoke(malformed(expanded,packed),10,{error:/archive:/});
 await invoke(malformed(0xffffffff,0xffffffff),0xffffffff,{budget:16*1024*1024,error:/resource:/});
 await invoke(malformed(0xffffffff,1),0xffffffff,{budget:16*1024*1024,error:/resource:/});
 const unused=Buffer.concat([original.subarray(0,14),original.subarray(14,-12),Buffer.alloc(8),Buffer.alloc(12)]);
 unused.writeUInt32BE(86,6);unused.writeUInt32BE(128^86,10);await invoke(unused,128,{error:/unused bytes/});
 const badReduce=Buffer.concat([malformed(20,15),Buffer.alloc(15),Buffer.alloc(12)]);await invoke(badReduce,20,{error:/archive:/});
 const cancelled=await invoke(rawBlocks[1].data,rawBlocks[1].expanded,{cancel:2,error:/cancelled:/});assert.equal(cancelled.length,0);checks++;
 // Corrupted entropy may still decode: its enclosing EGG CRC must reject it.
 // Here assert bounded output, finite completion and no native/sanitizer crash.
 for(let at=14;at<original.length-12;++at)for(const bit of [1,8,128]){
  const data=Buffer.from(original);data[at]^=bit;const input=path.join(root,'case.azo'),output=path.join(root,'case.out');await fs.writeFile(input,data);
  const result=spawnSync(probe,[input,output,'128',String(2*1024*1024)],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:4096,env});
  assert(!result.error,result.error?.message);assert([0,1].includes(result.status),'Native crash: '+result.stderr);assert(!/AddressSanitizer/.test(result.stderr),result.stderr);
  if(result.status===0)assert.equal((await fs.stat(output)).size,128);else assert.match(result.stderr,/^archive:/);checks++;
 }
 await fs.writeFile(path.join(root,'results'+suffix+'.json'),JSON.stringify({date:new Date().toISOString(),sourceCommit:manifest.commit,checks,sanitizer,decoded:results,scope:'AZO codec only; EGG container and content CRC pending integration'},null,2)+'\n');
 console.log(`EGG AZO C++ passed${sanitizer?' (AddressSanitizer)':''}: ${checks} checks, 5 independently hashed outputs, inner-block reset, stored/x86 vectors, malformed framing/entropy, memory refusal and cancellation. EGG product integration pending.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
