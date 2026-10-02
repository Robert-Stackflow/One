const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const moduleObject={exports:{}};vm.runInNewContext(buildSync({entryPoints:['src/shared/paged-rows.ts'],bundle:true,platform:'node',write:false}).outputFiles[0].text,{module:moduleObject,exports:moduleObject.exports});const {PagedRows}=moduleObject.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('fast scrolling bounds in-flight reads and replaces obsolete queued pages',async()=>{
 const requests=[],held=new Map();let changes=0;const rows=new PagedRows(page=>{requests.push(page);return new Promise(resolve=>held.set(page,resolve));},()=>changes++,()=>{});
 rows.demand(0,1000);assert.deepEqual(requests,[0,1]);rows.demand(999900,1000000);held.get(0)([{id:0}]);await tick();assert.deepEqual(requests,[0,1,9999]);held.get(1)([{id:100}]);held.get(9999)([{id:999900}]);await tick();assert.equal(rows.get(999900).id,999900);assert.equal(changes,3);rows.dispose();
});
test('cache evicts previous pages by count and text size while preserving visible blocks',async()=>{
 const requests=[],read=async page=>{requests.push(page);return[{id:page,text:'x'.repeat(page===7?200:30)}];};const rows=new PagedRows(read,()=>{},()=>{},1,3,100);
 for(let page=0;page<8;page++){rows.demand(page,page+1);await tick();assert.equal(rows.get(page).id,page);}
 assert.equal(rows.get(0),undefined);assert.equal(rows.get(5),undefined);assert.equal(rows.get(6),undefined);assert.equal(rows.get(7).text.length,200);
 rows.demand(2,3);await tick();assert.equal(rows.get(7),undefined);assert.equal(rows.get(2).id,2);assert.equal(requests.filter(page=>page===2).length,2);rows.dispose();
});
test('hidden results retain late data without rendering or starting queued reads',async()=>{
 const requests=[],held=new Map();let changes=0;const rows=new PagedRows(page=>{requests.push(page);return new Promise(resolve=>held.set(page,resolve));},()=>changes++,()=>{});
 rows.demand(0,300);rows.setActive(false);held.get(0)([{id:0}]);held.get(1)([{id:100}]);await tick();assert.equal(changes,0);assert.deepEqual(requests,[0,1]);assert.equal(rows.get(0).id,0);
 rows.setActive(true);assert.deepEqual(requests,[0,1,2]);held.get(2)([{id:200}]);await tick();assert.equal(changes,2);rows.dispose();
});
test('failures stop automatic retry loops, allow explicit retry, and disposal drops late replies',async()=>{
 let attempts=0,errors=0,changes=0;const rows=new PagedRows(async()=>{if(++attempts===1)throw Error('temporary');return[{id:0}];},()=>changes++,()=>errors++);
 rows.demand(0,10);await tick();assert.equal(errors,1);assert.equal(rows.hasFailed(0),true);rows.demand(0,10);await tick();assert.equal(attempts,1);rows.retry();await tick();assert.equal(rows.get(0).id,0);rows.dispose();
 let finish;const late=new PagedRows(()=>new Promise(resolve=>finish=resolve),()=>changes++,()=>{});late.demand(0,1);late.dispose();const before=changes;finish([{id:0}]);await tick();assert.equal(changes,before);assert.equal(late.get(0),undefined);
});
