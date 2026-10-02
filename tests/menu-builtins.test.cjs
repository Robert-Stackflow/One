const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
async function moduleFor(file,loader=require){const bundle=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const m={exports:{}};new Function('module','exports','require','__dirname',bundle.outputFiles[0].text)(m,m.exports,loader,process.cwd());return m.exports;}
const base={id:'a',parent:'',label:'命令',kind:'builtin',target:'registry',args:[],cwd:'',icon:'auto',enabled:true};
test('内置命令有唯一分类，旧 Shell 无损迁移为统一运行命令',async()=>{
 const {menuBuiltins}=await moduleFor('src/shared/menu-builtins.ts'),{validateMenu}=await moduleFor('src/shared/search.ts'),{builtinPlan}=await moduleFor('src/main/menu-builtins.ts');
 assert.ok(menuBuiltins.length>=28);assert.equal(new Set(menuBuiltins.map(c=>c.id)).size,menuBuiltins.length);
 for(const c of menuBuiltins){assert.ok(c.category);assert.doesNotThrow(()=>validateMenu([{...base,target:c.id}]));if(!c.onePage&&!c.oneAction&&!['opened','bookmarks','favorite-current','recent','copy-path','terminal','search','settings','apps','windows-settings','lock'].includes(c.id))assert.ok(builtinPlan(c.id),'launch plan '+c.id);}
 assert.throws(()=>validateMenu([{...base,target:'unknown'}]));
 const script='Write-Output $env:ONE_FOLDER\nWrite-Output "中文 & $()"',old={...base,kind:'shell',target:script,shell:'powershell',cwd:'{folder}'};
 const migrated=validateMenu([old])[0];assert.equal(migrated.kind,'command');assert.equal(migrated.shell,'powershell');assert.equal(migrated.target,script);assert.equal(migrated.cwd,'{folder}');
 assert.deepEqual(validateMenu([migrated]),[migrated]);assert.equal(validateMenu([{...base,kind:'command',target:'notepad.exe'}])[0].shell,undefined);
 assert.throws(()=>validateMenu([{...old,kind:'command',shell:'invalid'}]));assert.throws(()=>validateMenu([{...old,kind:'command',shell:'custom',shellPath:''}]));
 assert.equal(builtinPlan('hosts',{SystemRoot:'D:\\Windows'}).elevated,true);assert.equal(builtinPlan('hosts',{SystemRoot:'D:\\Windows'}).args[0],'D:\\Windows\\System32\\drivers\\etc\\hosts');
 const environment=builtinPlan('environment',{SystemRoot:'D:\\Windows Folder'});assert.deepEqual(environment.args,['"D:\\Windows Folder\\System32\\sysdm.cpl",EditEnvironmentVariables']);assert.equal(environment.windowsVerbatimArguments,true);
 for(const id of ['shutdown','restart','sign-out','hibernate']){assert.ok(menuBuiltins.find(c=>c.id===id).confirm);assert.ok(!builtinPlan(id).args.includes('/f'));}
});
test('电源操作默认取消，确认后才提交固定参数；统一 Shell 保留命令边界',async()=>{
 let response=0;const launches=[],prompts=[],external=[],loader=id=>id==='electron'?{shell:{openExternal:async uri=>external.push(uri)},clipboard:{},dialog:{showMessageBox:async options=>{prompts.push(options);return{response};}}}:require(id);
 const {SearchMenu}=await moduleFor('src/main/search-menu.ts',loader),config={bookmarks:[],menu:[{...base,target:'shutdown'},{...base,id:'shell',kind:'command',target:'Write-Output $env:ONE_FOLDER',shell:'powershell',cwd:'{folder}'},{...base,id:'apps',target:'apps'}]};
 const menu=new SearchMenu('work/current/unit/nonexistent-builtin-history.json',()=>config,{},()=>{},()=>{},async(...args)=>launches.push(args),async command=>{prompts.push(command);return response===1;}),nodes=await menu.open({kind:'menu',hwnd:0,pid:0,created:'',folders:[],currentFolder:'D:\\目录 & $()'});
 await menu.execute(nodes[0].id);assert.equal(launches.length,0);assert.equal(prompts[0].id,'shutdown');
 response=1;await menu.execute(nodes[0].id);assert.deepEqual(launches[0][1],['/s','/t','0']);
 await menu.execute(nodes[1].id);assert.equal(Buffer.from(launches[1][1].at(-1),'base64').toString('utf16le'),config.menu[1].target);assert.equal(launches[1][3].env.ONE_FOLDER,'D:\\目录 & $()');assert.equal(launches[1][3].console,true);
 await menu.execute(nodes[2].id);assert.deepEqual(external,['ms-settings:appsfeatures']);
});
test('One 内置动作从菜单或操作栏进入指定页面，取色委托应用而不启动外部程序',async()=>{
 const {menuBuiltins}=await moduleFor('src/shared/menu-builtins.ts'),{SearchMenu}=await moduleFor('src/main/search-menu.ts',id=>id==='electron'?{shell:{},clipboard:{}}:require(id)),{defaultSearch}=await moduleFor('src/shared/search.ts');
 const commands=menuBuiltins.filter(c=>c.onePage||c.oneAction),config=defaultSearch(),calls=[],launches=[];config.menu=commands.map(c=>({...base,id:c.id,target:c.id}));config.menuBar={top:{actions:['item:main-window'],right:['item:main-window']},bottom:{actions:['item:pick-color'],right:[]}};
 const menu=new SearchMenu('work/current/unit/nonexistent-one-history.json',()=>config,{},()=>{},()=>{},async(...args)=>launches.push(args),undefined,undefined,command=>calls.push(command));
 const nodes=await menu.open({kind:'menu',hwnd:0,pid:0,created:'',folders:[]}),bars=menu.toolbar();for(const node of [...nodes,...bars.top,...bars.bottom])await menu.execute(node.id);assert.deepEqual(new Set(calls.map(c=>c.id)),new Set(commands.map(c=>c.id)));assert.equal(calls.find(c=>c.id==='main-window').onePage,'home');assert.equal(calls.find(c=>c.id==='pick-color').oneAction,'pick-color');assert.deepEqual(launches,[]);
});
