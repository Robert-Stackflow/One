const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/shared/structured-preview.ts'],bundle:true,platform:'node',write:false}).outputFiles[0].text,moduleObject={exports:{}};
vm.runInNewContext(source,{module:moduleObject,exports:moduleObject.exports});const {StructureStore,StructureTree,structurePath}=moduleObject.exports;
const normalize=value=>JSON.parse(JSON.stringify(value));

test('large arrays return the final range without copying preceding properties',()=>{
 const store=new StructureStore(Array.from({length:120000},(_,id)=>({id,value:`ROW_${id}_END`}))),root=store.root();assert.equal(root.count,120000);
 const final=store.children(root.id,119920,80);assert.equal(final.length,80);assert.equal(final.at(-1).key,'119999');const content=store.children(final.at(-1).node.id,0,80);assert.equal(content[1].node.preview,'"ROW_119999_END"');assert.equal(store.text(final.at(-1).node.id,1),'ROW_119999_END');
});
test('object order, types and escaped property paths preserve actual data',()=>{
 const store=new StructureStore({'中文.名称':{'a"b':[null,false,-2,'value']},constructor:1,__proto__:null}),root=store.root(),entries=store.children(root.id,0,80),tree=new StructureTree(root);
 assert.equal(entries[0].key,'中文.名称');const outer=tree.locate(1),branch=tree.expand(outer,entries[0]);assert.equal(structurePath(outer,entries[0].key),'$["中文.名称"]');
 const nested=store.children(entries[0].node.id,0,80)[0],location=tree.locate(2);tree.expand(location,nested);assert.equal(structurePath(location,nested.key),'$["中文.名称"]["a\\"b"]');
 const values=store.children(nested.node.id,0,80);assert.deepEqual(normalize(values.map(entry=>entry.node.kind)),['null','boolean','number','string']);assert.equal(structurePath(tree.locate(6),'3'),'$["中文.名称"]["a\\"b"][3]');assert.equal(tree.position(branch),1);
});
test('flat positions account for nested expansion and recover correctly after collapse',()=>{
 const store=new StructureStore([{a:[1,2]},3,{last:true}]),tree=new StructureTree(store.root()),entries=store.children(0,0,80);assert.equal(tree.root.size,4);
 const first=tree.expand(tree.locate(1),entries[0]);assert.equal(tree.root.size,5);const a=store.children(first.node.id,0,80)[0],nested=tree.expand(tree.locate(2),a);assert.equal(tree.root.size,7);
 assert.deepEqual(normalize(Array.from({length:7},(_,i)=>{const location=tree.locate(i);return[location.parent?.key??null,location.index,location.branch?.key??null];})),[[null,0,'$'],['$',0,'0'],['0',0,'a'],['a',0,null],['a',1,null],['$',1,null],['$',2,null]]);
 assert.equal(tree.position(nested),2);tree.collapse(first);assert.equal(tree.root.size,4);assert.equal(tree.locate(3).index,2);assert.equal(first.children.size,0);assert.equal(tree.root.children.size,0);tree.collapseAll();assert.equal(tree.root.size,1);tree.expand(tree.locate(0),{index:0,key:'$',node:tree.root.node});assert.equal(tree.root.size,4);
});
test('shared aliases can expand, while ancestor cycles are detected without recursive serialization',()=>{
 const common={name:'shared'},value={first:common,second:common};value.self=value;const store=new StructureStore(value),tree=new StructureTree(store.root()),entries=store.children(0,0,80);
 assert.equal(entries[0].node.id,entries[1].node.id);assert.ok(tree.expand(tree.locate(1),entries[0]));assert.ok(tree.expand(tree.locate(3),entries[1]));const self=tree.locate(tree.root.size-1);assert.equal(tree.circular(self,entries[2].node),true);assert.equal(tree.expand(self,entries[2]),undefined);
});
test('long scalar previews remain bounded and the complete value is available on request',()=>{
 const full='中文\n'.repeat(100000)+'SCALAR_END',store=new StructureStore({long:full}),entry=store.children(0,0,1)[0];assert.equal(entry.node.truncated,true);assert.ok(entry.node.preview.length<1500);assert.equal(store.text(0,0),full);
 const scalar=new StructureStore(full);assert.equal(scalar.root().id,0);assert.equal(scalar.text(0),full);
});
test('invalid ranges and node ids fail explicitly',()=>{
 const store=new StructureStore([1,2]);for(const args of [[0,-1,1],[0,0,0],[0,0,257],[0,.5,2],[99,0,1]])assert.throws(()=>store.children(...args));assert.throws(()=>store.text(0,9));const tree=new StructureTree(store.root());assert.throws(()=>tree.locate(-1));assert.throws(()=>tree.locate(3));
});
test('very large row counts remain navigable without constructing individual row state',()=>{
 const store=new StructureStore(Array(2600000).fill(0)),tree=new StructureTree(store.root());assert.equal(tree.root.size,2600001);assert.equal(tree.locate(2600000).index,2599999);assert.equal(tree.root.children.size,0);
});
