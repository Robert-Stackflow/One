const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
const {join}=require('node:path'),{mkdir}=require('node:fs/promises');
async function moduleFor(file,loader=require){const output=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const module={exports:{}};new Function('module','exports','require','__dirname',output.outputFiles[0].text)(module,module.exports,loader,process.cwd());return module.exports;}

test('路径复制按索引根目录生成相对路径，并保留完整路径和命令行引号',async()=>{
 const {pathCopyText}=await moduleFor('src/shared/path-copy.ts'),path=String.raw`D:\Projects\One\docs\Guide.md`;
 assert.equal(pathCopyText(path,'full'),path);
 assert.equal(pathCopyText(path,'name'),'Guide.md');
 assert.equal(pathCopyText(path,'quoted'),`"${path}"`);
 assert.equal(pathCopyText(path,'relative',[String.raw`D:\Projects`,String.raw`d:\projects\one`]),String.raw`docs\Guide.md`);
 assert.equal(pathCopyText(path,'relative',[String.raw`D:\Other`]),'Guide.md');
});

test('DNS 仅接受域名，拒绝 URL 和本地路径',async()=>{
 const {dnsDomain}=await moduleFor('src/main/dns-check.ts');
 assert.equal(dnsDomain(' GitHub.COM. '),'github.com');
 assert.throws(()=>dnsDomain('https://github.com/'));
 assert.throws(()=>dnsDomain('C:\\Windows'));
 assert.throws(()=>dnsDomain('bad..example.com'));
});

test('快捷菜单在无法定位 Explorer 标签时仍可打开目标目录',async()=>{
 const opened=[],bridge={jump:()=>{throw Error('Explorer tab is no longer available');}},loader=id=>id==='electron'?{shell:{openPath:async path=>{opened.push(path);return '';}},clipboard:{writeText:()=>{}}}:require(id);
 const {SearchMenu}=await moduleFor('src/main/search-menu.ts',loader),{defaultSearch}=await moduleFor('src/shared/search.ts');
 const output=process.env.ONE_UNIT_OUTPUT_DIR||join(process.cwd(),'work/current/unit'),folder=join(output,'menu-folder');await mkdir(folder,{recursive:true});const config=defaultSearch();config.menu=[{id:'folder',parent:'',kind:'folder',label:'目录',target:folder,args:[],cwd:'',icon:'folder',enabled:true}];
 const menu=new SearchMenu(join(output,'history.json'),()=>config,bridge,()=>{},()=>{});
 for(const tab of [0,123]){const items=await menu.open({kind:'menu',hwnd:456,pid:12,created:'123',tab,folders:[]});await menu.execute(items[0].id);}
 assert.deepEqual(opened,[folder,folder]);
});
