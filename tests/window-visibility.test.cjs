const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/renderer/window-visibility.ts'],bundle:true,platform:'node',write:false}).outputFiles[0].text;
function fixture(){
 let event,resolve,reads=0,subscriptions=0;const initial=new Promise(r=>resolve=r),module={exports:{}};
 const one={windowState(){reads++;return initial;},onWindowState(callback){subscriptions++;event=callback;return()=>{};}};
 vm.runInNewContext(source,{window:{one},module,exports:module.exports});
 return{api:module.exports,initial:visible=>resolve({maximized:false,visible}),event:visible=>event({maximized:false,visible}),counts:()=>({reads,subscriptions})};
}
test('native visibility starts hidden and initializes only once',async()=>{const f=fixture();assert.equal(f.api.isWindowVisible(),false);f.api.setupWindowVisibility();f.api.setupWindowVisibility();assert.deepEqual(f.counts(),{reads:1,subscriptions:1});f.initial(false);await Promise.resolve();assert.equal(f.api.isWindowVisible(),false);});
test('a show event wins over an earlier pending hidden snapshot',async()=>{const f=fixture(),changes=[];f.api.onWindowVisibility(v=>changes.push(v));f.api.setupWindowVisibility();f.event(true);f.initial(false);await Promise.resolve();assert.equal(f.api.isWindowVisible(),true);assert.deepEqual(changes,[true]);});
test('a hide event invalidates an earlier visible snapshot even when already hidden',async()=>{const f=fixture();f.api.setupWindowVisibility();f.event(false);f.initial(true);await Promise.resolve();assert.equal(f.api.isWindowVisible(),false);});
test('maximize notifications do not repeat visibility work and listeners can unsubscribe',async()=>{const f=fixture(),changes=[];f.api.setupWindowVisibility();f.initial(true);await Promise.resolve();const stop=f.api.onWindowVisibility(v=>changes.push(v));f.event(true);f.event(false);f.event(false);f.event(true);stop();f.event(false);assert.deepEqual(changes,[false,true]);});
