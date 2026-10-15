const test=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
const stubs={
  'uiohook-napi':`import {EventEmitter} from 'node:events';export const UiohookKey={Escape:1};export const uIOhook=Object.assign(new EventEmitter(),{starts:0,stops:0,start(){this.starts++},stop(){this.stops++}});`,
  './native':`export const foreground=()=>null,lockWorkstation=()=>{},nativeAvailable=()=>true,nativeError='',keyboardIndicators=()=>({}),capsLockState=()=>false,modifiersHeld=()=>false;`,
  './levels':`export const levels={stop(){},corners(){}};`,
  './brightness':`export const brightness={};`,
};
let InputService,hook,key;
test.before(async()=>{
const built=await build({stdin:{contents:"export {InputService} from './src/main/input';export {uIOhook as hook,UiohookKey as key} from 'uiohook-napi';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'escape-fixture',setup(build){build.onResolve({filter:/^(uiohook-napi|\.\/native|\.\/levels|\.\/brightness)$/},args=>({path:args.path,namespace:'escape-fixture'}));build.onLoad({filter:/.*/,namespace:'escape-fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
const loaded={exports:{}};new Function('module','exports','require',built.outputFiles[0].text)(loaded,loaded.exports,require);
({InputService,hook,key}=loaded.exports);
});
const settings=keyEcho=>({keyEcho,explorerPreview:false,utilities:{clicker:{enabled:false}}});
const callbacks={caps(){}};
const press=(ctrlKey=false)=>hook.emit('keydown',{keycode:key.Escape,ctrlKey,altKey:false,shiftKey:false,metaKey:false});
const release=()=>hook.emit('keyup',{keycode:key.Escape});
test('scoped Escape consumers share the existing hook, ignore modifiers/repeats and release the idle hook',()=>{
  const input=new InputService(settings(false),callbacks),before={starts:hook.starts,stops:hook.stops};let calls=0;
  const first=input.onEscape(()=>{calls++;return true;}),second=input.onEscape(()=>{calls++;return true;});
  assert.equal(hook.starts-before.starts,1);press(true);release();assert.equal(calls,0);
  press();press();assert.equal(calls,2);release();press();release();assert.equal(calls,4);
  first();assert.equal(hook.stops-before.stops,0);second();assert.equal(hook.stops-before.stops,1);
  press();release();assert.equal(calls,4);input.stop();
});
test('disposing a capture subscription preserves the hook needed by existing input features',()=>{
  const input=new InputService(settings(true),callbacks),before=hook.stops;
  const dispose=input.onEscape(()=>true);dispose();assert.equal(hook.stops,before);
  input.stop();assert.equal(hook.stops,before+1);
});
