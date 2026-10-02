const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
async function moduleFor(file,loader=require){const bundle=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports','require','__dirname',bundle.outputFiles[0].text)(m,m.exports,loader,process.cwd());return m.exports;}
test('在此打开注册命令转换为统一目录参数，保留程序边界并排除其他占位符',async()=>{
 const {registeredPreset,hereCatalog}=await moduleFor('src/shared/menu-presets.ts');assert.ok(hereCatalog.length>=20);
 const base={id:'background/example',label:'Open &Tool here',file:'D:\\Program Files\\Tool\\tool.exe',args:['%V']};
 assert.deepEqual(registeredPreset(base).args,['{folder}']);assert.equal(registeredPreset(base).label,'Open Tool here');
 assert.deepEqual(registeredPreset({...base,file:'D:\\Git\\git-bash.exe',args:['--cd=%v.']}).args,['--cd={folder}']);
 assert.deepEqual(registeredPreset({...base,args:['--folder=%1','literal & | $()']}).args,['--folder={folder}','literal & | $()']);
 const cmd=registeredPreset({...base,file:'cmd.exe',args:['/s','/k','pushd','%V']});assert.equal(cmd.console,true);assert.deepEqual(cmd.args,['/d','/k']);
 assert.equal(registeredPreset({...base,args:['--unrelated']}),undefined);assert.equal(registeredPreset({...base,args:['%V','%2']}),undefined);
});
test('取消系统授权静默结束，启动错误仍提供简洁提示',async()=>{
 let code='0x800704c7';const loader=id=>id==='node:child_process'?{execFile:(_file,_args,_options,callback)=>{const error=Object.assign(Error('fixture'),{stderr:'Windows operation failed: '+code});callback(error);}}:require(id);
 const {launchMenuProgram}=await moduleFor('src/main/open-with.ts',loader);
 await assert.doesNotReject(()=>launchMenuProgram('D:\\Tool\\tool.exe',[]));
 code='0x80070005';await assert.rejects(()=>launchMenuProgram('D:\\Tool\\tool.exe',[]),/检查访问权限/);
 code='0x8007010b';await assert.rejects(()=>launchMenuProgram('D:\\Tool\\tool.exe',[]),/工作目录不存在/);
});
test('Windows 应用别名可检测，其他不可读取的链接不视为程序',async()=>{
 const path=require('node:path'),env={LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local'},alias=path.join(env.LOCALAPPDATA,'Microsoft/WindowsApps/wt.exe');
 const target='C:\\Program Files\\WindowsApps\\Terminal\\wt.exe',loader=id=>id==='node:fs/promises'?{stat:async()=>{throw Object.assign(Error(),{code:'EACCES'});},lstat:async()=>({isSymbolicLink:()=>true}),readlink:async()=>target}:require(id);
 const {availableProgram,programPath,programImagePath}=await moduleFor('src/main/program-path.ts',loader);
 assert.equal(await availableProgram(alias,env),true);assert.equal(await availableProgram('D:\\Private\\wt.exe',env),false);assert.equal(await availableProgram(alias.replace(/\.exe$/,'.txt'),env),false);
 assert.equal(await programPath('wt.exe',{...env,PATH:path.dirname(alias)}),alias);
 assert.equal(await programImagePath(alias,env),target);assert.equal(await programImagePath('D:\\Private\\wt.exe',env),'D:\\Private\\wt.exe');
});
test('同一程序的完整路径和裸名称注册项只显示一次',async()=>{
 const path=require('node:path'),env={SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local'},cmd=path.join(env.SystemRoot,'System32/cmd.exe');
 const registered=[{id:'background/cmd',label:'CMD',file:'cmd.exe',args:['/k','%V']},{id:'directory/cmd',label:'CMD',file:cmd,args:['/k','%1']}];
 const loader=id=>id==='node:child_process'?{execFile:(_file,_args,_options,callback)=>callback(null,JSON.stringify(registered),'')}:id==='node:fs/promises'?{stat:async file=>({isFile:()=>file.toLowerCase()===cmd.toLowerCase()}),lstat:async()=>({isSymbolicLink:()=>false}),readdir:async()=>[]}:require(id);
 const {MenuPresets}=await moduleFor('src/main/menu-presets.ts',loader),presets=await new MenuPresets(()=>[],env).read();
 assert.equal(presets.filter(p=>p.program?.toLowerCase()===cmd.toLowerCase()).length,1);assert.equal(presets.find(p=>p.id==='cmd').available,true);
});
