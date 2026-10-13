const test=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild');
const fixture={exports:{}},bundle=buildSync({stdin:{contents:"export * from './src/main/capture/shortcuts';export * from './src/shared/capture/shortcuts';export * from './src/shared/settings';export * from './src/shared/menu-builtins';export * from './src/renderer/search-commands';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
new Function('module','exports','require',bundle.outputFiles[0].text)(fixture,fixture.exports,require);
const {CaptureShortcutController,captureShortcutDefinitions,defaultCaptureShortcuts,captureAccelerator,validateCaptureShortcuts,defaultSettings,mergeSettings,validateSettings,captureSystemCommands,menuBuiltins}=fixture.exports;
test('Search commands resolve every migrated page and direct action by name and pinyin',()=>{
  const {commandMatches}=fixture.exports;
  for(const [id,name,pinyin] of [['page:capture','打开截图','dakaijietu'],['page:recording','打开录制','dakailuzhi'],['page:materials','打开素材','dakaisucai'],['page:pins','打开贴图','dakaitietu'],['capture-region','区域截图','quyujietu'],['capture-custom','自定义截屏','zidingyijieping'],['pins-clipboard','贴出剪贴板','tiechujian tieban']]){
    assert.equal(commandMatches(name,1)[0].path,'action:'+id);assert.equal(commandMatches(pinyin,1)[0].path,'action:'+id);
  }
  for(const command of Object.keys(captureSystemCommands).filter(id=>id!=='capture-recording'))assert.ok(commandMatches('',100).some(item=>item.path==='action:'+command));
});
const keys=()=>Object.fromEntries(captureShortcutDefinitions.map(({id},i)=>[id,`Ctrl+Alt+F${13+i}`]));
function context(){
  const registered=new Map([['foreign',()=>{}]]),unregistered=[],calls=[],errors=[],published=[];let enabled=true,owner;
  const controller=new CaptureShortcutController({register:(key,callback)=>{if(registered.has(key))return false;registered.set(key,callback);return true;},unregister:key=>{unregistered.push(key);registered.delete(key);},conflict:key=>owner?.key===key?owner.label:undefined,enabled:()=>enabled,run:async action=>{calls.push(action);},failed:error=>errors.push(error),publish:state=>published.push(state)});
  return {controller,registered,unregistered,calls,errors,published,enable:value=>{enabled=value;},owner:value=>{owner=value;}};
}

test('Eight One shortcut preferences retain source defaults, optional F keys and normalized Windows combinations',()=>{
  const defaults=defaultCaptureShortcuts();assert.equal(Object.keys(defaults).length,8);assert.equal(defaults.region,'Ctrl+Shift+F8');assert.equal(defaults.pinClipboard,'Ctrl+Shift+F9');
  assert.equal(captureAccelerator('f24'),'F24');assert.equal(captureAccelerator('Win+Ctrl+ArrowUp'),'Control+Super+Up');assert.equal(captureAccelerator('Ctrl+Up'),'Control+Up');
  for(const value of ['A','F25','Ctrl+Ctrl+A','Win+','Ctrl+NotAKey'])assert.throws(()=>captureAccelerator(value));
  assert.throws(()=>validateCaptureShortcuts({region:8}));defaults.region='';assert.equal(defaultCaptureShortcuts().region,'Ctrl+Shift+F8');
  for(const [command,action] of Object.entries(captureSystemCommands))if(action!=='recording')assert.equal(menuBuiltins.find(item=>item.id===command).oneAction,command);
});

test('Nested settings and backup round trips keep all eight bindings and other One settings independent',()=>{
  const original=defaultSettings(),snapshot=structuredClone(original),edited=mergeSettings(original,{capture:{shortcuts:keys()}});
  assert.deepEqual(original,snapshot);assert.deepEqual(edited.capture.shortcuts,keys());assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(edited))),edited);
  assert.equal(edited.colorShortcut,original.colorShortcut);assert.deepEqual(edited.capture.workflows,original.capture.workflows);
  assert.throws(()=>mergeSettings(edited,{capture:{shortcuts:{unknown:'F12'}}}));assert.throws(()=>mergeSettings(edited,{capture:{shortcuts:{copy:'Ctrl+'}}}));
  const partial=structuredClone(original);delete partial.capture.shortcuts;assert.deepEqual(validateSettings(partial).capture.shortcuts,defaultCaptureShortcuts());
});

test('All eight registrations dispatch their own actions and leave foreign registrations intact on pause and stop',()=>{
  const c=context();c.controller.configure(keys());assert.equal(c.controller.state().paused,false);
  for(const {id} of captureShortcutDefinitions){assert.equal(c.controller.state().entries[id].active,true);c.registered.get(captureAccelerator(keys()[id]))();}
  assert.deepEqual(c.calls,captureShortcutDefinitions.map(({id})=>id));c.controller.pause();assert.equal(c.registered.size,1);assert.ok(c.registered.has('foreign'));
  c.controller.trigger('region');assert.equal(c.calls.length,8);c.controller.configure(keys());c.controller.stop();c.controller.configure(keys());assert.equal(c.registered.size,1);
});

test('Duplicate, known One and external conflicts retain the configured values and recover after release',()=>{
  const c=context(),value=keys();value.copy=value.region;c.owner({key:captureAccelerator(value.screen),label:'屏幕取色'});c.registered.set(captureAccelerator(value.custom),()=>{});
  c.controller.configure(value);const state=c.controller.state();assert.equal(state.entries.region.active,true);assert.match(state.entries.copy.error,/区域截图/);assert.match(state.entries.screen.error,/屏幕取色/);assert.match(state.entries.custom.error,/占用/);
  assert.equal(c.registered.size,7);assert.equal(value.custom,keys().custom);c.registered.delete(captureAccelerator(value.custom));c.owner(undefined);value.copy='F24';c.controller.configure(value);
  for(const {id} of captureShortcutDefinitions)assert.deepEqual(c.controller.state().entries[id],{active:true,error:''});assert.ok(c.registered.has('foreign'));
});

test('Unchanged configuration preserves registrations; old callbacks cannot run after recording pause or rebinding',()=>{
  const c=context();c.controller.configure(keys());const old=c.registered.get(captureAccelerator(keys().region));c.controller.configure(keys());assert.equal(c.unregistered.length,0);
  c.controller.pause();old();assert.deepEqual(c.calls,[]);c.controller.configure(keys());old();assert.deepEqual(c.calls,[]);
  c.enable(false);c.registered.get(captureAccelerator(keys().region))();assert.deepEqual(c.calls,[]);c.enable(true);c.controller.trigger('region');assert.deepEqual(c.calls,['region']);
});

test('Business failures are reported without dropping working hotkeys',async()=>{
  const errors=[],controller=new CaptureShortcutController({register:()=>true,unregister:()=>{},conflict:()=>undefined,enabled:()=>true,run:async()=>{throw Error('采集占用');},failed:error=>errors.push(error.message),publish:()=>{}});
  controller.configure(keys());controller.trigger('region');await Promise.resolve();await Promise.resolve();assert.deepEqual(errors,['采集占用']);assert.equal(controller.state().entries.region.active,true);
});

test('A newly configured One owner releases the conflicting capture binding even when its preference is unchanged',()=>{
  const c=context();c.controller.configure(keys());c.owner({key:captureAccelerator(keys().region),label:'窗口置顶'});c.controller.configure(keys());
  assert.equal(c.controller.state().entries.region.active,false);assert.match(c.controller.state().entries.region.error,/窗口置顶/);assert.equal(c.controller.state().entries.copy.active,true);
  c.owner(undefined);c.controller.configure(keys());assert.deepEqual(c.controller.state().entries.region,{active:true,error:''});
});
