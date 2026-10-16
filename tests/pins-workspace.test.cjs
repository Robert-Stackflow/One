const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {buildSync}=require('esbuild');
function moduleFor(file){const result=buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});const module={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,require);return module.exports;}
const {PinStore}=moduleFor('src/main/pins/store.ts'),{workspaceFrom,zoomPin,pinBounds}=moduleFor('src/shared/pins.ts');
const view=()=>({x:100,y:80,scale:1,rotation:0,flipX:false,flipY:false,opacity:.7,passThrough:true,visible:true});
async function directory(t){const base=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(base,'one-pins-test-'));t.after(async()=>{const actual=await fs.realpath(dir);assert(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith('one-pins-test-'));await fs.rm(actual,{recursive:true,force:true});});return dir;}
test('One pin workspace rejects foreign identity and does not overwrite invalid storage',async t=>{
  assert.throws(()=>workspaceFrom({version:1,pins:[],groups:[]}),/工作区无效/);
  const dir=await directory(t),file=path.join(dir,'workspace.json'),original='{"version":1,"pins":[],"groups":[]}';await fs.writeFile(file,original);
  await assert.rejects(new PinStore(dir).init(),/工作区无效/);assert.equal(await fs.readFile(file,'utf8'),original);
});
test('Pin content survives reopening while windows and pass-through restore safely',async t=>{
  const dir=await directory(t),store=new PinStore(dir);await store.init();const created=await store.add('参考文字',{kind:'text',text:'内容\n第二行'},view());
  await store.change(w=>{w.groups.push({id:'12ac8348-6a0d-4a21-b96a-9318377432fd',name:'参考'});w.pins[0].group=w.groups[0].id;w.pins[0].view.rotation=3;});await store.flush();
  const recovered=new PinStore(dir);await recovered.init();const item=recovered.get(created.id);
  assert.equal(recovered.snapshot().format,'one-pin-workspace');assert.equal(item.content.text,'内容\n第二行');assert.equal(item.group,recovered.snapshot().groups[0].id);
  assert.equal(item.view.rotation,3);assert.equal(item.view.opacity,.7);assert.equal(item.view.visible,false);assert.equal(item.view.passThrough,false);
});
test('A failed pin index write preserves the prior workspace and permits the next save',async t=>{
  const dir=await directory(t),store=new PinStore(dir);await store.init();const created=await store.add('原内容',{kind:'text',text:'不能丢失'},view());
  const file=path.join(dir,'workspace.json'),backup=path.join(dir,'before.json'),before=await fs.readFile(file);await fs.rename(file,backup);await fs.mkdir(file);
  await assert.rejects(store.change(w=>{w.pins[0].title='失败保存';}));assert.equal(store.get(created.id).title,'原内容');assert.deepEqual(await fs.readFile(backup),before);
  await fs.rmdir(file);await fs.rename(backup,file);await store.change(w=>{w.pins[0].title='成功保存';});assert.equal(JSON.parse(await fs.readFile(file,'utf8')).pins[0].title,'成功保存');
});
test('Shared immutable image bytes remain until the final pin reference is removed',async t=>{
  const dir=await directory(t),store=new PinStore(dir);await store.init();const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const hash=await store.installImage(png),content={kind:'image',hash,width:1,height:1},first=await store.add('第一份',content,view()),second=await store.add('第二份',content,view());
  await store.change(w=>{w.pins=w.pins.filter(p=>p.id!==first.id);});await store.collect();assert.deepEqual(await store.read(second.id),png);
  await store.change(w=>{w.pins=[];});await store.collect();assert.deepEqual(await fs.readdir(path.join(dir,'images')),[]);
});
test('Zoom keeps the pointer anchor and rejects invalid geometry',()=>{
  const record={id:'12ac8348-6a0d-4a21-b96a-9318377432fd',title:'图',group:null,created:1,content:{kind:'image',hash:'a'.repeat(64),width:400,height:200},view:view()};
  const previous=pinBounds(record.content,record.view),next=zoomPin(record,1,.25,.75),bounds=pinBounds(record.content,next);
  assert.equal(previous.x+previous.width*.25,bounds.x+bounds.width*.25);assert.equal(previous.y+previous.height*.75,bounds.y+bounds.height*.75);
  assert.throws(()=>zoomPin(record,1,Infinity,0));assert.throws(()=>zoomPin(record,2,0,0));
});


test('Pin OCR hands immutable original image bytes and title to recognition without using the clipboard',async t=>{
  const result=buildSync({entryPoints:['src/main/pins/service.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['koffi','electron']}),module={exports:{}};
  new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,name=>name==='electron'?{}:require(name));
  const dir=await directory(t),received=[],context={register(){},createWindow(){throw Error('OCR should not require a pin window');},mainWindow(){},dark:()=>false,blocked:()=>false,uiScale:()=>100,icon(){},recognize:async(png,title)=>{received.push({png:Buffer.from(png),title});}};
  const service=new module.exports.PinService(dir,()=>{},()=>{},error=>{throw error;},context);await service.init();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  const hash=await service.store.installImage(png),image=await service.store.add('原图识别',{kind:'image',hash,width:1,height:1},view());
  await service.action(image.id,{kind:'recognize'});assert.deepEqual(received,[{png,title:'原图识别'}]);assert.deepEqual(await service.store.read(image.id),png);
  const text=await service.store.add('文字',{kind:'text',text:'not an image'},view());await assert.rejects(service.action(text.id,{kind:'recognize'}),/只有图片/);assert.equal(received.length,1);
  context.recognize=undefined;await assert.rejects(service.action(image.id,{kind:'recognize'}),/暂不可用/);
});
