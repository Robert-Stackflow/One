const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild');
function load(file){const module={exports:{}};new Function('module','exports','require',buildSync({entryPoints:[file],bundle:true,platform:'node',write:false}).outputFiles[0].text)(module,module.exports,require);return module.exports;}
const {ScanNodeStore,scanNodePatch}=load('src/main/scan-node-store.ts'),{ScanTree}=load('src/shared/scan-tree.ts');
const node=(path,parent,directory=false,size=1)=>({path,parent,name:path.split(/[\\/]/).filter(Boolean).at(-1)||path,directory,size,modified:123});
const progress=(nodes,removed=[])=>({rootPath:'root',path:'root',files:0,directories:0,bytes:0,issues:0,nodes,removed});

test('compact scan paths preserve Unicode, case, roots, UNC and unusual spelling at IPC boundaries',()=>{
 const rows=[node('C:\\',null,true),node('C:\\中文 & X.txt','C:\\'),node('C:\\MiXeD\\a.TXT','C:\\MiXeD'),node('\\\\server\\share\\A.txt','\\\\server\\share'),node('/root/a.txt','/root'),node('relative/thing.txt','alternate'),{...node('C:\\MiXeD\\issue','C:\\MiXeD'),name:'different',issue:'不能读取'}];
 const store=new ScanNodeStore();for(const row of rows){const saved=store.retain(row);assert.deepEqual(scanNodePatch(saved),{...row,issue:row.issue});saved.size=900;assert.equal(scanNodePatch(saved).size,900);store.release(saved);}assert.equal(store.prefixes.size,0);
 const a=store.retain(node('C:\\shared\\a','C:\\shared')),b=store.retain(node('C:\\shared\\b','C:\\shared'));assert.equal(a.prefix,b.prefix);store.release(a);assert.equal(b.path,'C:\\shared\\b');assert.equal(store.prefixes.size,1);store.release(b);assert.equal(store.prefixes.size,0);
});
test('monitoring does not retain dead parent prefixes after repeated folder creation and deletion',()=>{
 const store=new ScanNodeStore();for(let i=0;i<10000;i++){const parent='D:\\change-'+i,a=store.retain(node(parent+'\\a',parent)),b=store.retain(node(parent+'\\b',parent));store.release(a);store.release(b);}assert.equal(store.prefixes.size,0);
});
test('scan relations attach across out-of-order batches and preserve identity without duplicate links',()=>{
 const tree=new ScanTree();tree.apply(progress([node('leaf','folder')]));const leaf=tree.nodes.get('leaf');tree.apply(progress([node('root',null,true),node('folder','root',true)]));assert.deepEqual(tree.ancestors(leaf).map(n=>n.path),['root','folder']);
 tree.apply(progress([node('other','root',true),node('leaf','other',false,50),node('leaf','other',false,60)]));assert.equal(tree.nodes.get('leaf'),leaf);assert.equal(leaf.size,60);assert.equal(tree.nodes.get('folder').children.length,0);assert.equal(tree.nodes.get('other').children.length,1);assert.equal(tree.parentOf(leaf).path,'other');
 assert.equal(JSON.parse(JSON.stringify(leaf)).parent,undefined);assert.equal(tree.waiting.size,0);
});
test('large folder removals clear descendants in one pass and replacement paths get fresh identities',()=>{
 const tree=new ScanTree(),rows=[node('root',null,true),node('folder','root',true)];for(let i=0;i<30000;i++)rows.push(node('leaf'+i,'folder'));tree.apply(progress(rows));const old=tree.nodes.get('folder');assert.equal(old.children.length,30000);assert.equal(tree.nodes.get('leaf0').children,tree.nodes.get('leaf29999').children);
 tree.apply(progress([],['folder']));assert.equal(tree.nodes.size,1);assert.equal(tree.root.children.length,0);assert.equal(tree.waiting.size,0);tree.apply(progress([node('folder','root',true),node('new','folder')]));assert.notEqual(tree.nodes.get('folder'),old);assert.equal(tree.root.children.length,1);assert.equal(tree.nodes.get('folder').children.length,1);
});
