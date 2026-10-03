const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
async function moduleFor(file,loader=require,external=[]){const bundle=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['electron','koffi',...external]});const m={exports:{}};new Function('module','exports','require','__dirname',bundle.outputFiles[0].text)(m,m.exports,loader,process.cwd());return m.exports;}
const env={userprofile:'D:\\Users\\甲',programdata:'D:\\ProgramData',systemdrive:'D:',systemroot:'D:\\Windows',programw6432:'E:\\Program Files','programfiles(x86)':'E:\\Program Files (x86)'};
test('default directories expand the host environment, preserve user scope/rules and migrate only once',async()=>{
 const {defaultSearch,validateSearch}=await moduleFor('src/shared/search.ts'),{defaultIndexPriorities,migrateSearchDefaults}=await moduleFor('src/main/search-defaults.ts');
 const defaults=defaultIndexPriorities(env);assert.equal(defaults.length,11);assert.equal(defaults.filter(r=>r.priority==='normal').length,3);assert.equal(defaults.filter(r=>r.priority==='uncommon').length,8);
 assert.deepEqual(defaults.slice(0,3).map(r=>r.path),['D:\\Users\\甲\\AppData\\Roaming\\Microsoft\\Internet Explorer','D:\\Users\\甲\\AppData\\Roaming\\Microsoft\\Windows','D:\\ProgramData\\Microsoft\\Windows\\Start Menu']);assert.deepEqual(defaultIndexPriorities({}),[]);assert.ok(defaults.some(r=>r.path==='D:\\$WINDOWS.~BT'));
 const old=defaultSearch();delete old.programShortcut;delete old.priorityDefaultsVersion;old.roots=['D:\\'];old.excluded=['E:\\Program Files (x86)'];old.priorities=[{path:'d:/ProgramData/',priority:'high'}];
 const normalized=validateSearch(old);assert.equal(normalized.programShortcut,'Ctrl+Alt+P');const migrated=migrateSearchDefaults(normalized,env);assert.deepEqual(migrated.roots,old.roots);assert.deepEqual(migrated.excluded,old.excluded);assert.equal(migrated.priorities[0].priority,'high');assert.equal(migrated.priorities.filter(r=>r.path.toLowerCase().includes('programdata')&&r.path.endsWith('/')).length,1);assert.ok(!migrated.priorities.some(r=>r.path==='E:\\Program Files (x86)'));assert.equal(migrated.priorityDefaultsVersion,1);
 const deleted=validateSearch({...migrated,priorities:[]});assert.equal(migrateSearchDefaults(deleted,env),deleted);assert.deepEqual(deleted.priorities,[]);
 const full=validateSearch({...normalized,priorities:Array.from({length:64},(_,n)=>({path:'D:\\Custom'+n,priority:'high'}))});assert.equal(migrateSearchDefaults(full,env).priorities.length,64);
 for(const programShortcut of [null,1,'P','Ctrl+','Ctrl+Alt+P\n'])assert.throws(()=>validateSearch({...normalized,programShortcut}));assert.equal(validateSearch({...normalized,programShortcut:''}).programShortcut,'');
});
test('program path captures one foreground target, resolves Windows frame hosts, and rejects stale or ambiguous targets',async()=>{
 const {focusedProgramPath}=await moduleFor('src/main/focused-program.ts');let reads=0;
 const ordinary={foreground:()=>{reads++;return 100;},pid:()=>7,image:()=> 'E:\\Apps\\实际程序.exe',children:()=>{throw Error('not needed');}};
 assert.equal(focusedProgramPath(ordinary),'E:\\Apps\\实际程序.exe');assert.equal(reads,1);
 const hosted={foreground:()=>100,pid:h=>h===100?7:h===1?8:9,image:p=>p===7?'D:\\Windows\\System32\\ApplicationFrameHost.exe':p===8?'E:\\Store\\App.exe':'E:\\Store\\Other.exe',children:()=>[1,1]};assert.equal(focusedProgramPath(hosted),'E:\\Store\\App.exe');assert.throws(()=>focusedProgramPath({...hosted,children:()=>[1,2]}),/实际路径/);assert.throws(()=>focusedProgramPath({...hosted,children:()=>[]}),/实际路径/);
 let calls=0;assert.throws(()=>focusedProgramPath({...ordinary,pid:()=>++calls===1?7:8}),/已关闭/);assert.throws(()=>focusedProgramPath({...ordinary,foreground:()=>0}),/没有/);assert.throws(()=>focusedProgramPath({...ordinary,image:()=>{throw Error('权限不足');}}),/权限不足/);assert.throws(()=>focusedProgramPath({...ordinary,image:()=> 'relative.exe'}),/有效/);
});
test('both search shortcuts register independently, capture before reveal, and release during recording and shutdown',async()=>{
 const {defaultSearch}=await moduleFor('src/shared/search.ts'),callbacks=new Map(),revealed=[],notices=[],calls=[];let captured='E:\\Apps\\focused.exe';
 const loader=id=>id==='electron'?{globalShortcut:{register(key,run){if(callbacks.has(key))return false;callbacks.set(key,run);return true;},unregister(key){callbacks.delete(key);}},shell:{showItemInFolder(path){revealed.push(path);captured='E:\\Windows\\explorer.exe';}}}:id==='./native'?{foreground:()=>({hwnd:42})}:id==='./focused-program'?{focusedProgramPath:()=>{if(!captured)throw Error('权限不足');return captured;}}:require(id);
 const {SearchBridge}=await moduleFor('src/main/search-bridge.ts',loader,['./native','./focused-program']);const bridge=new SearchBridge((...args)=>calls.push(args),()=>{},message=>notices.push(message));const settings=defaultSearch();bridge.update(settings);
 assert.deepEqual([...callbacks.keys()],['Control+Alt+F','Control+Alt+P']);callbacks.get('Control+Alt+P')();assert.deepEqual(revealed,['E:\\Apps\\focused.exe']);assert.equal(calls.length,0);callbacks.get('Control+Alt+F')();assert.deepEqual(calls,[['search',42,false]]);captured='';callbacks.get('Control+Alt+P')();assert.deepEqual(notices,['权限不足']);assert.equal(revealed.length,1);
 bridge.record(true);assert.equal(callbacks.size,0);bridge.record(false);assert.equal(callbacks.size,2);
 bridge.update({...settings,programShortcut:'Ctrl+Shift+P'});assert.equal(callbacks.has('Control+Alt+P'),false);assert.equal(callbacks.has('Control+Shift+P'),true);
 bridge.update({...settings,programShortcut:settings.shortcut});assert.match(bridge.error,/程序定位快捷键已被占用/);assert.equal(callbacks.size,1);
 bridge.update({...settings,shortcut:''});assert.equal(callbacks.size,1);assert.equal(bridge.error,'');bridge.stop();assert.equal(callbacks.size,0);
});
