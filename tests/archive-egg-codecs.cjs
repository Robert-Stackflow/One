const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {execFile,spawnSync}=require('node:child_process'),{promisify}=require('node:util');const run=promisify(execFile),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;},u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;},end=u32(0x08e28222);
const table=Array.from({length:256},(_,i)=>{let v=i;for(let j=0;j<8;j++)v=(v>>>1)^((v&1)?0xedb88320:0);return v>>>0;});
const crc=bytes=>{let v=0xffffffff;for(const b of bytes)v=(v>>>8)^table[(v^b)&255];return (v^0xffffffff)>>>0;};
const extra=(id,bytes)=>Buffer.concat([u32(id),Buffer.from([0]),u16(bytes.length),bytes]);
const root=(solid=false)=>Buffer.concat([u32(0x41474745),u16(256),u32(1),u32(0),...(solid?[extra(0x24e5a060,Buffer.alloc(0))]:[]),end]);
function create(blocks,{name='data.bin',encryption,solid=false,files}={}){
 const total=blocks.reduce((n,b)=>n+b.expanded,0),members=files||[{name,size:total}];
 const headers=members.map((file,i)=>Buffer.concat([u32(0x0a8590e3),u32(i),u64(file.size),extra(0x0a8591ac,Buffer.from(file.name)),...(encryption?[extra(0x08d1470f,encryption)]:[]),end]));
 return Buffer.concat([root(solid),...headers,...blocks.map(b=>Buffer.concat([u32(0x02b50c13),Buffer.from([b.method,0]),u32(b.expanded),u32(b.data.length),u32(b.crc),end,b.data])),end]);
}
// Bounded framing walk for hashed, non-split/non-solid mutation fixtures only.
function frames(data){let p=14,cryptoAt;const blocks=[];let sizeAt;
 function extras(){while(true){assert(p+4<=data.length);const sig=data.readUInt32LE(p);p+=4;if(sig===0x08e28222)return;const flags=data[p++],size=(flags&1)?data.readUInt32LE(p):data.readUInt16LE(p);p+=(flags&1)?4:2;if(sig===0x08d1470f)cryptoAt=p;const aux=sig===0x0a8591ac?((flags&8)?2:0)+((flags&16)?4:0):0;p+=size+aux;assert(p<=data.length);}}
 extras();while(p<data.length){const at=p,sig=data.readUInt32LE(p);p+=4;if(sig===0x08e28222){assert.equal(p,data.length);break;}
  if(sig===0x0a8590e3){sizeAt=p+4;p+=12;extras();}else if(sig===0x02b50c13){const method=data[p],expanded=data.readUInt32LE(p+2),packed=data.readUInt32LE(p+6),sum=data.readUInt32LE(p+10);p+=14;assert.equal(data.readUInt32LE(p),0x08e28222);p+=4;blocks.push({at,dataAt:p,method,expanded,packed,crc:sum});p+=packed;assert(p<=data.length);}
  else if([0x04c63672,0x07463307,0x08d1470f].includes(sig)){const flags=data[p++],size=(flags&1)?data.readUInt32LE(p):data.readUInt16LE(p);p+=(flags&1)?4:2;if(sig===0x08d1470f)cryptoAt=p;p+=size;assert(p<=data.length);}
  else assert.fail('Unexpected mutation fixture signature '+sig.toString(16)+' at '+at);
 }return {cryptoAt,sizeAt,blocks};
}
function encrypt(blocks,method,password){
 const raw=Buffer.concat(blocks.map(b=>b.data)),passwordBytes=Buffer.from(password);let encrypted,metadata;
 if(method===0){const keys=[0x12345678,0x23456789,0x34567890];const update=b=>{keys[0]=((keys[0]>>>8)^table[(keys[0]^b)&255])>>>0;keys[1]=(Math.imul((keys[1]+(keys[0]&255))>>>0,134775813)+1)>>>0;keys[2]=((keys[2]>>>8)^table[(keys[2]^(keys[1]>>>24))&255])>>>0;};
  for(const b of passwordBytes)update(b);const transform=input=>Buffer.from(input.map(b=>{const t=(keys[2]|2)&65535,c=b^((Math.imul(t,t^1)>>>8)&255);update(b);return c;}));
  const verify=0x12345678,header=Buffer.from('0102030405060708090a0b12','hex');metadata=Buffer.concat([Buffer.from([0]),transform(header),u32(verify)]);encrypted=transform(raw);
 }else{const length=method===2?32:16,salt=crypto.createHash('sha256').update('test-only EGG salt '+method).digest().subarray(0,length/2),derived=crypto.pbkdf2Sync(passwordBytes,salt,1000,2*length+2,'sha1');
  const counters=Buffer.alloc(Math.ceil(raw.length/16)*16);for(let i=0;i<counters.length/16;i++)counters.writeUInt32LE(i+1,i*16);const cipher=crypto.createCipheriv('aes-'+length*8+'-ecb',derived.subarray(0,length),null);cipher.setAutoPadding(false);
  const stream=Buffer.concat([cipher.update(counters),cipher.final()]);encrypted=Buffer.from(raw.map((b,i)=>b^stream[i]));const mac=crypto.createHmac('sha1',derived.subarray(length,2*length)).update(encrypted).digest().subarray(0,10);
  metadata=Buffer.concat([Buffer.from([method]),salt,derived.subarray(2*length),mac]);
 }
 let offset=0;return {encryption:metadata,blocks:blocks.map(b=>{const data=encrypted.subarray(offset,offset+b.data.length);offset+=b.data.length;return {...b,data};})};
}
async function main(){
 const output=path.resolve('work/archive-build/egg-codecs-all'),fixtures=path.resolve('tests/fixtures/archives/egg');await fs.mkdir(output,{recursive:true});
 const manifest=JSON.parse(await fs.readFile(path.join(fixtures,'manifest.json'),'utf8')),sanitizer=process.argv.includes('--asan'),suffix=sanitizer?'-asan':'';
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const found=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true,maxBuffer:4096}),installation=found.stdout.trim();assert(installation);
 const command=path.join(output,'build'+suffix+'.cmd'),probe=path.join(output,'probe'+suffix+'.exe'),env={...process.env};
 if(sanitizer){const versions=(await fs.readdir(path.join(installation,'VC/Tools/MSVC'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})),bin=path.join(installation,'VC/Tools/MSVC',versions[0],'bin/Hostx64/x64');await fs.access(path.join(bin,'clang_rt.asan_dynamic-x86_64.dll'));const key=Object.keys(env).find(x=>x.toLowerCase()==='path')||'PATH';env[key]=bin+';'+(env[key]||'');}
 const sources=['native/archive/egg-container.cpp','native/archive/egg-crypto.cpp','native/archive/egg-azo.cpp','native/archive/egg-codecs.cpp','tests/archive-egg-codecs-native.cpp'];
 const thirdParty=['bzlib','decompress','huffman','crctable','randtable','compress','blocksort'].map(name=>path.resolve('vendor/archive/alz-bzip2',name+'.c'));
 const flags=`/nologo /EHsc /MT /utf-8 /DBZ_NO_STDIO ${sanitizer?`/O1 /Zi /fsanitize=address /Fd:"${output}/codecs.pdb"`:'/O2'} /I"${path.resolve('work/archive-source/zlib')}" /I"${path.resolve('work/archive-build/zlib')}" /I"${path.resolve('vendor/archive/alz-bzip2')}" /I"${path.resolve('vendor/archive/xz/src/liblzma/api')}"`;
 const objects=[...sources,...thirdParty].map(file=>'"'+path.join(output,path.basename(file).replace(/\.(cpp|c)$/,'.obj'))+'"').join(' ');
 await fs.writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl ${flags} /std:c++20 /W4 /WX /c ${sources.map(file=>'"'+path.resolve(file)+'"').join(' ')} /Fo:"${output}/"\r\nif errorlevel 1 exit /b 1\r\ncl ${flags} /c ${thirdParty.map(file=>'"'+file+'"').join(' ')} /Fo:"${output}/"\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /MT ${sanitizer?'/fsanitize=address':''} ${objects} /Fe:"${probe}" /link ${sanitizer?'/DEBUG':''} "${path.resolve('work/archive-build/zlib/Release/zlibstatic.lib')}" "${path.resolve('work/archive-build/xz/Release/lzma.lib')}" bcrypt.lib\r\n`);
 try{const built=await run('cmd.exe',['/d','/c',command],{windowsHide:true,maxBuffer:65536});await fs.writeFile(path.join(output,'build'+suffix+'.log'),built.stdout+built.stderr);}
 catch(error){await fs.writeFile(path.join(output,'build'+suffix+'.log'),(error.stdout||'')+(error.stderr||''));throw Error('EGG codecs probe build failed; see '+path.join(output,'build'+suffix+'.log'));}
 let checks=0,sequence=0,compared=0;const results=[];
 async function invoke(inputs,{error,password='password12345!',memory=128*1024*1024,limit=64*1024*1024,cancel=0}={}){
  const paths=[];for(let i=0;i<inputs.length;i++){if(Buffer.isBuffer(inputs[i])){const file=path.join(output,'case-'+i+'.egg');await fs.writeFile(file,inputs[i]);paths.push(file);}else paths.push(inputs[i]);}
  const result=spawnSync(probe,[String(memory),String(limit),String(cancel),password,...paths],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:16384,env});
  assert(!result.error,result.error?.message);assert.equal(result.signal,null);assert.equal(result.status,error?1:0,'case '+sequence+': '+result.stderr);assert(!/AddressSanitizer/.test(result.stderr),result.stderr);checks++;sequence++;
  if(error){assert.match(result.stderr,error);assert.equal(result.stdout,'','Failure must not emit success/hashes');return;}const actual=JSON.parse(result.stdout);assert.equal(actual.blockCrcVerified,true);return actual;
 }
 for(const fixture of manifest.fixtures){const input=path.join(fixtures,fixture.name),data=await fs.readFile(input);assert.equal(data.length,fixture.bytes);assert.equal(hash(data),fixture.sha256);const paths=[input];
  if(fixture.name==='number.vol1.egg')paths.push(path.join(fixtures,'number.vol2.egg'));
  if(fixture.oracleStatus==='output-limit'){await invoke(paths,{error:/resource:/,password:fixture.password||'password12345!'});continue;}
  const actual=await invoke(paths,{password:fixture.password||'password12345!'});
  if(fixture.oracleStatus==='decoded'){assert.deepEqual(actual.entries,fixture.result.entries.map(({size,actual,sha256})=>({size,actual,sha256})),fixture.name);assert.equal(actual.solid,fixture.result.solid);assert.equal(actual.split,fixture.result.split);checks+=3;compared++;}
  else if(fixture.oracleStatus==='known-crc-failure'){assert.equal(actual.entries[0].size,15);assert.equal(actual.entries[0].sha256,'a8a2f6ebe286697c527eb35a58b5539532e9b3ae3b64d4eb0a46fb657b41562c');assert.notEqual(actual.entries[0].sha256,fixture.upstreamResult.entries[0].sha256);checks+=3;}
  else{assert.equal(fixture.name,'extattr.egg');const f=frames(data),expected=f.blocks.map(b=>{const raw=data.subarray(b.dataAt,b.dataAt+b.packed),plain=zlib.inflateRawSync(raw);assert.equal(crc(plain),b.crc);return hash(plain);});expected.splice(3,0,hash(Buffer.alloc(0)));assert.deepEqual(actual.entries.map(x=>x.sha256),expected);checks++;}
  results.push({name:fixture.name,entries:actual.entries.length,outputBytes:actual.outputBytes,oracleStatus:fixture.oracleStatus,sha256:actual.entries.map(x=>x.sha256)});
  if(fixture.result.entries?.some(x=>x.encrypted))await invoke(paths,{password:'incorrect password',error:/password:|archive:/});
 }
 // Mutate actual writer archives: salt/verifier and MAC are in metadata, not
 // interleaved with packed data. Authentication failures must survive success
 // decoding/CRC and produce no successful result.
 for(const name of ['lorem_long_aes128.egg','lorem_long_aes256.egg','lorem_long_store_lea128.egg','lorem_long_store_lea256.egg','lorem_long_zipEnc.egg']){
  const original=await fs.readFile(path.join(fixtures,name)),f=frames(original),method=original[f.cryptoAt],salt=(method===2||method===6)?16:8;
  if(method!==0){for(const at of [f.cryptoAt+1,f.cryptoAt+1+salt]){const data=Buffer.from(original);data[at]^=1;await invoke([data],{error:/password:/});}
   for(let i=0;i<10;i++){const data=Buffer.from(original);data[f.cryptoAt+1+salt+2+i]^=1;await invoke([data],{error:/authentication/});}
  }
  for(const at of [f.blocks[0].at+14,f.blocks[0].dataAt+Math.floor(f.blocks[0].packed/2)]){const data=Buffer.from(original);data[at]^=1;await invoke([data],{error:/archive:|safety:/});}
 }
 // Deliberate verifier collision in the original AES128 weighted comparison.
 {const original=await fs.readFile(path.join(fixtures,'lorem_long_aes128.egg')),f=frames(original),at=f.cryptoAt+9,data=Buffer.from(original),a=data[at],b=data[at+1];
  if(a<128){assert(b>0);data[at]+=128;data[at+1]--;}else{assert(b<255);data[at]-=128;data[at+1]++;}assert.equal(data[at]+128*data[at+1],a+128*b);await invoke([data],{error:/password:/});}
 const plain=[Buffer.from('first block 中文 '.repeat(37)),Buffer.from('second independent compressed block '.repeat(4000))];
 const blocks=plain.map(bytes=>({method:1,expanded:bytes.length,crc:crc(bytes),data:zlib.deflateRawSync(bytes)}));assert.notEqual(blocks[0].data.length%16,0);
 for(const method of [0,1,2]){const password='汉字🔐 päss',encrypted=encrypt(blocks,method,password),data=create(encrypted.blocks,{encryption:encrypted.encryption}),actual=await invoke([data],{password});assert.equal(actual.entries[0].sha256,hash(Buffer.concat(plain)));checks++;
  await invoke([data],{password:password+'!',error:/password:|archive:/});}
 // Preserve an external AZO stream unchanged and independently AES-wrap it.
 const source=await fs.readFile(path.join(fixtures,'azoshort_txt.egg')),f=frames(source),b=f.blocks[0],azo={method:3,expanded:b.expanded,crc:b.crc,data:source.subarray(b.dataAt,b.dataAt+b.packed)};
 for(const method of [1,2]){const password='AZO 中文🔐',encrypted=encrypt([azo],method,password),actual=await invoke([create(encrypted.blocks,{encryption:encrypted.encryption})],{password});assert.equal(actual.entries[0].sha256,manifest.fixtures.find(x=>x.name==='azoshort_txt.egg').result.entries[0].sha256);checks++;}
 const stored=[Buffer.from('ab'),Buffer.from('cdef')].map(bytes=>({method:0,expanded:bytes.length,crc:crc(bytes),data:bytes}));
 const solid=await invoke([create(stored,{solid:true,files:[{name:'one',size:3},{name:'two',size:3}]})]);assert.deepEqual(solid.entries.map(x=>x.sha256),[hash(Buffer.from('abc')),hash(Buffer.from('def'))]);checks++;
 // CRC and packed consumption remain mandatory for every block/method.
 for(const name of ['azoshort_txt.egg','defaults_bz_optimized.egg','lzma_simple.egg','small_kor.egg']){const original=await fs.readFile(path.join(fixtures,name)),f=frames(original),b=f.blocks[0],data=Buffer.from(original);data[b.at+14]^=1;await invoke([data],{error:/CRC32/});}
 await invoke([path.join(fixtures,'azonumbers.egg')],{memory:2*1024*1024,error:/resource:/});
 await invoke([path.join(fixtures,'defaults_bz_optimized.egg')],{memory:2*1024*1024,error:/resource:/});
 await invoke([path.join(fixtures,'lzma_simple.egg')],{memory:16*1024*1024,error:/resource:/});
 await invoke([path.join(fixtures,'azonumbers.egg')],{cancel:20,error:/cancelled:/});
 await invoke([path.join(fixtures,'zeros.egg')],{limit:65536,error:/resource:/});
 const trailing=Buffer.concat([source.subarray(0,b.dataAt+b.packed),Buffer.from([0]),source.subarray(b.dataAt+b.packed)]);trailing.writeUInt32LE(b.packed+1,b.at+10);await invoke([trailing],{error:/archive:/});
 await fs.writeFile(path.join(output,'results'+suffix+'.json'),JSON.stringify({date:new Date().toISOString(),referenceCommit:manifest.commit,checks,sanitizer,comparedDatasets:compared,results,scope:'Native core only; product entry points pending. ASan covers new native modules/BZip2; zlib/liblzma remain existing release libraries.'},null,2)+'\n');
 console.log(`EGG C++ codecs passed${sanitizer?' (AddressSanitizer)':''}: ${checks} checks, ${compared} independent decoded datasets, CRC-correct short LEA/attributes, all 5 codecs, AES/LEA/ZipCrypto, continuous multi-block encryption, MAC/CRC tampering, memory/output limits and cancellation. Product integration pending.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
