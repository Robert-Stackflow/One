const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/renderer/virtual-rows.ts'],bundle:true,platform:'node',write:false}).outputFiles[0].text,moduleObject={exports:{}};vm.runInNewContext(source,{module:moduleObject,exports:moduleObject.exports});const {variableRange}=moduleObject.exports;
const heightsModule={exports:{}};vm.runInNewContext(buildSync({entryPoints:['src/shared/row-heights.ts'],bundle:true,platform:'node',write:false}).outputFiles[0].text,{module:heightsModule,exports:heightsModule.exports});const {RowHeights}=heightsModule.exports;

test('sparse expanded rows agree with complete cumulative heights at boundaries and inside rows',()=>{
 const rows=new RowHeights(32,5000),sizes=Array(5000).fill(32);for(let p=0;p<5000;p+=97){sizes[p]=73+(p%23)/8;rows.set(p,sizes[p]);}
 let offset=0;for(let p=0;p<5000;p++){assert.equal(rows.offset(p),offset);assert.equal(rows.position(offset),p);assert.equal(rows.position(offset+sizes[p]-.125),p);offset+=sizes[p];}assert.equal(rows.total,offset);assert.equal(rows.position(Infinity),5000);assert.equal(rows.position(-1),0);
 rows.set(0,32);rows.set(97,32);sizes[0]=sizes[97]=32;assert.equal(rows.total,sizes.reduce((a,b)=>a+b,0));assert.equal(rows.offset(98),sizes.slice(0,98).reduce((a,b)=>a+b,0));assert.equal(rows.set(97,32.125),true);assert.equal(rows.size(97),32.125);
});
test('variable rows preserve exact logical anchors and expose the last row under physical scaling',()=>{
 const rows=new RowHeights(96,2600001);rows.set(0,310);rows.set(1700000,96.75);rows.set(2600000,480);const height=480,first=variableRange(rows,height,0),last=variableRange(rows,height,Infinity);assert.equal(first.start,0);assert.equal(last.end,rows.count);assert.equal(last.physical,16000000);assert.equal(last.logical,rows.total-height);assert.ok(last.end-last.start<30);
 for(const p of [1,123,1700000,2599000]){const logical=rows.offset(p)+17.25,top=logical*last.physicalLast/last.last,range=variableRange(rows,height,top);assert.ok(Math.abs(range.logical-logical)<.0001);assert.equal(rows.position(range.logical),p);assert.ok(Math.abs(range.logical-rows.offset(p)-17.25)<.0001);}
 for(const error of [0,.5,1])assert.equal(variableRange(rows,height,last.physicalLast-error).logical,last.last);
});
test('an expanded row taller than the viewport is never skipped and reset releases sparse heights',()=>{
 const rows=new RowHeights(96,1000);rows.set(15,4000);const range=variableRange(rows,500,rows.offset(15)+1200);assert.ok(range.start<=15&&range.end>15);assert.equal(rows.position(range.logical),15);rows.reset(2);assert.equal(rows.total,192);assert.equal(rows.size(0),96);rows.reset(0);assert.equal(variableRange(rows,500,900).end,0);assert.equal(rows.total,0);assert.equal(rows.set(0,100),false);assert.throws(()=>new RowHeights(0),/高度/);assert.throws(()=>rows.reset(-1),/行数/);
});
