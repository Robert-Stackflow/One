const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild');
const {pe,fixtures}=require('./application-preview-fixtures.cjs');
let base,root,files,program,packages,rtf,preferences,prepare;
async function load(file,overrides={}){const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'warning'}),m={exports:{}};new Function('require','module','exports','__dirname',result.outputFiles[0].text)(name=>Object.hasOwn(overrides,name)?overrides[name]:require(name),m,m.exports,root);return m.exports;}
before(async()=>{
 base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/current');await fs.mkdir(base,{recursive:true});root=await fs.mkdtemp(path.join(base,'search-preview-unit-'));files=await fixtures(root);
 const {mainOptions}=await import('../scripts/bundle-options.mjs');await build({...mainOptions,entryPoints:['src/main/preview-worker.ts'],outdir:root,sourcemap:false,logLevel:'warning'});
 [program,packages,rtf,preferences,prepare]=await Promise.all(['src/main/preview-program.ts','src/main/preview-package.ts','src/main/preview-rtf.ts','src/shared/preview.ts','src/main/preview-service.ts'].map(file=>load(file)));
});
after(async()=>{if(!root)return;const real=await fs.realpath(root);assert.equal(path.dirname(real),await fs.realpath(base));assert.ok(path.basename(real).startsWith('search-preview-unit-'));await fs.rm(real,{recursive:true,force:true});});
test('program inspection reads architecture, versions, resources, dependencies and exports without loading code',async()=>{
 const result=await program.inspectProgram(files['example.exe']);assert.equal(result.metadata['架构'],'x64');assert.equal(result.metadata['文件版本'],'1.2.3.4');assert.equal(result.metadata['产品版本'],'5.6.7.8');assert.equal(result.metadata['公司'],'Example Company');assert.equal(result.application.title,'Example application');assert.deepEqual(result.application.dependencies,['KERNEL32.dll']);assert.deepEqual(result.application.exports,['RunExample']);
 assert.equal((await program.inspectProgram(files['example.dll'])).metadata['文件类型'],'动态链接库');
});
test('PE32 x86 and ARM64 headers use the correct optional-header directory layout',async()=>{
 const bytes=pe(),optional=0x98;bytes.copy(bytes,optional+96,optional+112,optional+112+128);bytes.copy(bytes,optional+0xe0,optional+0xf0,optional+0xf0+40);bytes.writeUInt16LE(0x14c,0x84);bytes.writeUInt16LE(0xe0,0x94);bytes.writeUInt16LE(0x10b,optional);bytes.writeUInt32LE(16,optional+92);const file=path.join(root,'x86.dll');await fs.writeFile(file,bytes);const result=await program.inspectProgram(file);assert.equal(result.metadata['格式'],'PE32');assert.equal(result.metadata['架构'],'x86');assert.equal(result.metadata['文件版本'],'1.2.3.4');
 const arm=pe();arm.writeUInt16LE(0xaa64,0x84);await fs.writeFile(file,arm);assert.equal((await program.inspectProgram(file)).metadata['架构'],'ARM64');
});
test('program ranges and version resources remain bounded for corrupt files',async()=>{
 await assert.rejects(program.inspectProgram(files['broken.exe']),/有效/);
 const bad=pe();bad.writeUInt32LE(0xfffffff0,0x98+112+2*8);const name=path.join(root,'bad-resource.dll');await fs.writeFile(name,bad);const result=await program.inspectProgram(name);assert.equal(result.metadata['架构'],'x64');assert.match(result.metadata['版本资源'],/无法读取/);
 const sections=pe();sections.writeUInt16LE(0xffff,0x86);const file=path.join(root,'bad-sections.dll');await fs.writeFile(file,sections);await assert.rejects(program.inspectProgram(file),/文件头/);
});
test('real Windows executable and DLL resources can be read without a process launch',{skip:process.platform!=='win32'},async()=>{
 const result=await program.inspectProgram(process.execPath);assert.equal(result.metadata['架构'],({x64:'x64',ia32:'x86',arm64:'ARM64'})[process.arch]);assert.ok(result.metadata['文件版本']);
 const library=await program.inspectProgram(path.join(process.env.SystemRoot,'System32/kernel32.dll'));assert.equal(library.metadata['文件类型'],'动态链接库');assert.ok(library.application.exports.length);
});
test('MSIX and APPX manifests expose identity, requirements, dependencies, capabilities and application entries',async()=>{
 for(const name of ['sample.msix','sample.appx']){const result=await packages.inspectPackage(files[name]);assert.equal(result.application.title,'示例应用');assert.equal(result.metadata['版本'],'1.2.3.4');assert.equal(result.metadata['架构'],'x64');assert.match(result.metadata['签名'],/未验证/);assert.ok(result.application.dependencies[0].includes('Microsoft.VCLibs'));assert.ok(result.application.sections.some(s=>s.title==='声明的能力'&&s.facts[0].value==='internetClient'));}
});
test('bundle metadata lists contained packages without unpacking or installing them',async()=>{
 for(const name of ['sample.msixbundle','sample.appxbundle']){const result=await packages.inspectPackage(files[name]);assert.equal(result.application.packages.length,2);assert.equal(result.application.packages[1].architecture,'arm64');assert.equal(result.metadata['包名称'],'One.Preview.Example');}
 await assert.rejects(packages.inspectPackage(files['entity.msix']),/可解析范围/);
});
test('RTF preserves Unicode, escaped text, basic styles and metadata, excluding objects and unknown destinations',async()=>{
 const result=await rtf.inspectRtf(files['document.rtf']),paragraphs=result.richText.paragraphs,text=paragraphs.flatMap(p=>p.runs.map(r=>r.text)).join('\n');
 assert.match(text,/中文/);assert.match(text,/Escaped: \\ \{ \}/);assert.match(text,/<img src=/);assert.doesNotMatch(text,/dangerous-object|deadbeef|hidden content|Preview example/);assert.equal(result.metadata['标题'],'Preview example');assert.equal(paragraphs[0].align,'center');assert.equal(paragraphs[0].runs[0].bold,true);assert.ok(paragraphs[1].runs.some(r=>r.italic));assert.ok(paragraphs[1].runs.some(r=>r.underline));assert.match(result.metadata['嵌入对象'],/不加载/);
});
test('RTF decodes DBCS bytes and rejects truncated, deeply nested or oversized binary groups',()=>{
 const parsed=rtf.parseRtf(Buffer.from("{\\rtf1\\ansi\\ansicpg936 \\'d6\\'d0\\'ce\\'c4}"));assert.equal(parsed.richText.paragraphs[0].runs[0].text,'中文');
 for(const value of ['plain text','{\\rtf1 unclosed','{\\rtf1 '+ '{'.repeat(300)+'x'+'}'.repeat(301),'{\\rtf1{\\pict\\bin999 x}}'])assert.throws(()=>rtf.parseRtf(Buffer.from(value)));
});
test('RTF byte chunks preserve UTF-8 and DBCS characters across internal decoding boundaries',()=>{
 const text='a'+'中文'.repeat(2500);
 const utf8=Buffer.concat([Buffer.from('{\\rtf1\\ansi\\ansicpg65001 '),Buffer.from(text,'utf8'),Buffer.from('}')]);
 assert.equal(rtf.parseRtf(utf8).richText.paragraphs[0].runs[0].text,text);
 const ansi=Buffer.concat([Buffer.from('{\\rtf1\\ansi\\ansicpg936 a'),Buffer.from(Array.from({length:2500},()=>[0xd6,0xd0,0xce,0xc4]).flat()),Buffer.from('}')]);
 assert.equal(rtf.parseRtf(ansi).richText.paragraphs[0].runs[0].text,text);
});
test('old preview settings migrate with application parsing disabled and invalid options are rejected',()=>{
 const old=preferences.defaultPreview();delete old.applicationFiles;assert.equal(preferences.validatePreview(old).applicationFiles,false);assert.equal(preferences.defaultPreview().applicationFiles,false);assert.throws(()=>preferences.validatePreview({...old,applicationFiles:'yes'}),/开关/);
});
test('disabled program and package previews never start a parser worker or register executable assets',async()=>{
 let workers=0;const safe=await load('src/main/preview-service.ts',{'node:worker_threads':{Worker:class{constructor(){workers++;throw Error('Parser must remain disabled');}}}});
 for(const name of ['example.exe','example.dll','sample.msix','sample.msixbundle']){const data=await safe.preparePreview(files[name],()=>{throw Error('Executable asset exposed');},async()=>({}));assert.equal(data.applicationBlocked,true);assert.equal(data.type,'unsupported');assert.equal(data.application,undefined);assert.equal(data.url,undefined);}assert.equal(workers,0);
});
test('enabled preview pipeline parses application/package/RTF in its owned worker',async()=>{
 for(const [name,type]of [['example.exe','application'],['example.dll','application'],['sample.msix','application'],['sample.msixbundle','application'],['document.rtf','rtf']]){const data=await prepare.preparePreview(files[name],()=>{throw Error('Unnecessary resource registration');},async()=>({}),{applicationFiles:true});assert.equal(data.type,type,data.error);assert.ok(data.metadata['格式']);assert.equal(data.applicationBlocked,undefined);}
});
