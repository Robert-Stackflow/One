const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild'),{EventEmitter}=require('node:events'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','picker-test');let PickerStore,picker,display,fit;
before(async()=>{
 await fs.mkdir(out,{recursive:true});
 await build({entryPoints:['src/main/picker-store.ts','src/main/picker-directory-worker.ts'],outdir:out,bundle:true,platform:'node',external:['koffi'],outExtension:{'.js':'.cjs'}});
 await build({entryPoints:['src/shared/picker.ts'],outfile:path.join(out,'model.cjs'),bundle:true,platform:'node'});
 await build({entryPoints:['src/main/picker.ts'],outfile:path.join(out,'service.cjs'),bundle:true,platform:'node',external:['koffi'],plugins:[{name:'electron-fixture',setup(b){b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`exports.app={getPath:()=>${JSON.stringify(out)}};exports.BrowserWindow=class{};`,loader:'js'}));}}]});
 ({PickerStore}=require(path.join(out,'picker-store.cjs')));picker=require(path.join(out,'service.cjs'));({pickerDisplayName:display,fitPickerBounds:fit}=require(path.join(out,'model.cjs')));
});
test('picker history is bounded, canonical, atomic and preserved with preferences across restart',async()=>{
 const file=path.join(out,'history.json'),store=new PickerStore(file);await store.load();
 for(let i=0;i<25;i++)await store.remember(path.join(out,'folder'+i));
 await Promise.all([store.remember(path.join(out,'last')),store.update({showHidden:true,showExtensions:false})]);
 await store.remember(path.join(out,'LAST'));const restored=new PickerStore(file);await restored.load();
 assert.equal(restored.recent.length,20);assert.deepEqual(restored.preferences,{showHidden:true,showExtensions:false});
 assert.equal(new Set(restored.recent.map(p=>p.toLowerCase())).size,20);await assert.rejects(store.update({showHidden:'yes',showExtensions:true}),/显示选项/);
 assert.deepEqual((await fs.readdir(out)).filter(name=>name.endsWith('.tmp')),[]);
 await store.windowBounds({x:-1800,y:40,width:950,height:680});await store.clearRecent();const cleared=new PickerStore(file);await cleared.load();assert.deepEqual(cleared.recent,[]);assert.deepEqual(cleared.preferences,{showHidden:true,showExtensions:false});assert.deepEqual(cleared.bounds,{x:-1800,y:40,width:950,height:680});
 await fs.writeFile(file,JSON.stringify({recent:['relative',42,path.join(out,'valid'),path.join(out,'VALID')],showHidden:'bad',showExtensions:false}));const normalized=new PickerStore(file);await normalized.load();assert.equal(normalized.recent.length,1);assert.deepEqual(normalized.preferences,{showHidden:false,showExtensions:false});
 await fs.writeFile(file,'broken');const corrupt=new PickerStore(file);await corrupt.load();assert.deepEqual(corrupt.recent,[]);
});
test('picker geometry restores negative monitor positions and clamps a disconnected monitor to visible space',()=>{
 const old={x:-1800,y:40,width:950,height:680};assert.deepEqual(fit(old,{x:-1920,y:0,width:1920,height:1040}),old);
 assert.deepEqual(fit(old,{x:0,y:0,width:1920,height:1040}),{x:0,y:40,width:950,height:680});
 assert.deepEqual(fit({x:5000,y:5000,width:2000,height:1800},{x:0,y:30,width:800,height:550}),{x:0,y:30,width:800,height:550});
});
test('hidden extension labels never change actual paths or lose leading-dot filenames',()=>{
 for(const [name,directory,expected]of [['report.docx',false,'report'],['archive.tar.gz',false,'archive.tar'],['.gitignore',false,'.gitignore'],['foo.bar',true,'foo.bar']]){
  const entry={name,directory,path:path.join(out,name),hidden:false};assert.equal(display(entry,false),expected);assert.equal(display(entry,true),name);assert.equal(entry.path,path.join(out,name));
 }
});
class Window extends EventEmitter{
 constructor(id){super();this.webContents={id};this.destroyed=false;}
 close(){this.destroyed=true;this.emit('closed');}isDestroyed(){return this.destroyed;}
}
test('actual directory worker hides Windows attributes, cancels stale navigation and releases closed pickers',async()=>{
 const root=await fs.mkdtemp(path.join(out,'files-')),child=path.join(root,'child');await fs.mkdir(child);
 await fs.writeFile(path.join(root,'item10.txt'),'10');await fs.writeFile(path.join(root,'item2.txt'),'2');await fs.writeFile(path.join(root,'.visible.txt'),'dot');const hidden=path.join(root,'hidden.txt');await fs.writeFile(hidden,'hidden');
 if(process.platform==='win32')await promisify(execFile)('attrib',['+h',hidden],{windowsHide:true});
 const w=new Window(1),result=picker.pick(w,'file','选择文件','',root);let data=await picker.pickerData(1);
 assert.deepEqual(data.entries.map(entry=>entry.name),['child','.visible.txt','item2.txt','item10.txt']);
 await picker.pickerPreferences(1,{showHidden:true,showExtensions:false});data=await picker.pickerData(1);assert.equal(data.entries.find(entry=>entry.name==='hidden.txt').hidden,true);
 const slow=picker.pickerData(1,root);const stale=assert.rejects(slow,/已取消/);const next=await picker.pickerData(1,child);await stale;assert.equal(next.path,child);
 const pending=picker.pickerData(1,root);const rejected=assert.rejects(pending,/已取消/);w.close();await rejected;assert.equal(await result,null);await assert.rejects(picker.pickerData(1),/已关闭/);
 const dir=new Window(2),chosen=picker.pick(dir,'directory','选择文件夹','',root);data=await picker.pickerData(2);assert.equal(data.entries.length,1);assert.equal(data.entries[0].directory,true);await picker.choose(dir,child);assert.equal(await chosen,child);await new Promise(r=>setTimeout(r,40));assert.ok(dir.destroyed);
});
test('save overwrite, invalid filename and recent/opened places keep the picker contract',async()=>{
 const file=path.join(out,'existing.txt');await fs.writeFile(file,'original');picker.configurePicker(()=>[out,out.toUpperCase(),'relative'],async()=>[{path:out},{path:out.toUpperCase()}]);
 const w=new Window(3),selected=picker.pick(w,'save','保存','existing.txt',out);await picker.pickerData(3);const locations=await picker.pickerPlaces(3);assert.equal(locations.bookmarks.length,1);assert.equal(locations.common.length,6);assert.ok(locations.recent.length>0);assert.equal((await picker.pickerOpened(3)).places.length,1);
 picker.configurePicker(()=>[],async()=>{throw Error('offline');});assert.match((await picker.pickerOpened(3)).error,/刷新/);
 assert.deepEqual(await picker.choose(w,file),{overwrite:true});assert.equal(await fs.readFile(file,'utf8'),'original');await assert.rejects(picker.choose(w,path.join(out,'CON.txt')),/文件名/);await assert.rejects(picker.choose(w,path.join(out,'foo','nested.txt')),/文件名/);
 await picker.choose(w,file,true);assert.equal(await selected,file);assert.equal(await fs.readFile(file,'utf8'),'original','The picker selects; its caller alone writes the file');await new Promise(r=>setTimeout(r,40));
});
