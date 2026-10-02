const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
const item=(id,parent='',kind='builtin')=>({id,parent,kind,label:id,target:kind==='builtin'?'opened':'',args:[],cwd:'',icon:'folder',enabled:true});
async function load(){const bundle=await build({entryPoints:['src/shared/menu-tree.ts'],bundle:true,platform:'node',format:'cjs',write:false}),m={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(m,m.exports,require);return m.exports.moveMenuItem;}
test('菜单拖拽区分前后插入和移入分组，保留子树及其他同级顺序',async()=>{
 const move=await load(),items=[item('a'),item('g','','group'),item('c','g'),item('b'),item('h','g','group'),item('d','h')];
 assert.deepEqual(move(items,'b','a','before').filter(i=>!i.parent).map(i=>i.id),['b','a','g']);
 assert.deepEqual(move(items,'a','g','after').filter(i=>!i.parent).map(i=>i.id),['g','a','b']);
 const inside=move(items,'a','g','inside');assert.equal(inside.find(i=>i.id==='a').parent,'g');assert.deepEqual(inside.filter(i=>i.parent==='g').map(i=>i.id),['c','h','a']);
 const outside=move(items,'h','g','after');assert.equal(outside.find(i=>i.id==='h').parent,'');assert.equal(outside.find(i=>i.id==='d').parent,'h');assert.equal(items.find(i=>i.id==='a').parent,'');
});
test('拖拽拒绝循环和超深嵌套，分隔线与普通项目不会成为上级菜单',async()=>{
 const move=await load(),items=[item('g','','group'),item('h','g','group'),item('c','h'),item('a')];assert.deepEqual(move(items,'g','h','inside'),items);assert.deepEqual(move(items,'g','c','after'),items);assert.deepEqual(move(items,'a','c','inside'),items);assert.deepEqual(move(items,'a','a','after'),items);
 const deep=[item('g','','group'),item('h','g','group'),item('i','h','group'),item('j','i','group'),item('x','','group'),item('child','x')];assert.throws(()=>move(deep,'x','j','inside'),/最多五层/);
});
