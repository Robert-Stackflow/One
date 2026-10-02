const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/renderer/event-snapshot.ts'],bundle:true,platform:'node',write:false}).outputFiles[0].text;
function fixture(){
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports});
 let push,resolve;const initial=new Promise(r=>resolve=r),applied=[];
 const ready=module.exports.subscribeSnapshot(listener=>{push=listener;},()=>initial,value=>applied.push(value));
 return{push:value=>push(value),resolve:value=>resolve(value),ready,applied};
}
test('a cold menu uses its initial snapshot and later reset events',async()=>{const f=fixture();f.resolve(['root']);await f.ready;f.push(['child']);assert.deepEqual(f.applied,[['root'],['child']]);});
test('a menu reset arriving before the initial empty response is preserved',async()=>{const f=fixture();f.push(['child']);f.resolve([]);await f.ready;assert.deepEqual(f.applied,[['child']]);});
test('several new menu sessions survive an older pending snapshot',async()=>{const f=fixture();f.push(['first']);f.push(['second']);f.resolve(['stale']);await f.ready;f.push(['third']);assert.deepEqual(f.applied,[['first'],['second'],['third']]);});
