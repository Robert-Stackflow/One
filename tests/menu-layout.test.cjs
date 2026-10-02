const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
const item=(id,parent='',kind='builtin')=>({id,parent,kind,target:kind==='builtin'?'copy-path':'',label:id,icon:'copy',args:[],cwd:'',enabled:true});
async function helpers(){const bundle=await build({entryPoints:['src/shared/menu-layout.ts'],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(m,m.exports);return m.exports;}
test('菜单与图标栏之间移动保留命令、子菜单和唯一显示位置',async()=>{
 const {placeInBar,placeInMenu,reorderBar,materializeBar}=await helpers();let layout={menu:[item('a'),item('group','','group'),item('child','group'),item('z')],menuBar:{top:{actions:['favorite','builtin:settings'],right:['builtin:settings']},bottom:{actions:[],right:[]}}};
 layout.menu[2].args=['a b','{selected}'];layout.menu[2].cwd='{folder}';layout.menu[2].enabled=false;
 layout=placeInBar(layout,'child','top','favorite');assert.deepEqual(layout.menuBar.top.actions,['item:child','favorite','builtin:settings']);assert.equal(layout.menu.find(i=>i.id==='child').parent,'');assert.equal(layout.menu.find(i=>i.id==='child').enabled,false);
 layout=reorderBar(layout,'item:child','top');assert.deepEqual(layout.menuBar.top.actions,['favorite','builtin:settings','item:child']);
 layout=placeInMenu(layout,'item:child','unused','group','inside');assert.equal(layout.menu.find(i=>i.id==='child').parent,'group');assert.deepEqual(layout.menu.find(i=>i.id==='child').args,['a b','{selected}']);assert.equal(layout.menu.find(i=>i.id==='child').cwd,'{folder}');assert.equal(layout.menuBar.top.actions.includes('item:child'),false);
 layout=placeInBar(layout,'group','top');assert.equal(layout.menu.find(i=>i.id==='child').parent,'group');assert.equal(placeInMenu(layout,'item:group','unused','child','inside'),layout,'Returning a group into its own child must not create a cycle or consume its toolbar entry');
 layout=placeInMenu(layout,'item:group','unused','a','before');assert.equal(layout.menu[0].id,'group');assert.equal(layout.menu.find(i=>i.id==='child').parent,'group');
 layout=materializeBar(layout,'favorite','new-favorite');assert.equal(layout.menu.at(-1).target,'favorite-current');assert.equal(layout.menuBar.top.actions[0],'item:new-favorite');assert.equal(materializeBar(layout,'favorite','stale'),layout);
 layout.menuBar.top.actions=['favorite','builtin:settings','builtin:opened','builtin:recent','builtin:search','builtin:copy-path','builtin:bookmarks'];assert.throws(()=>placeInBar(layout,'z','top'),/7/);assert.equal(layout.menuBar.top.actions.length,7);
});
test('两个操作栏独立排序与对齐，分隔线可跨栏和返回菜单，满栏拒绝移动而不丢失项目',async()=>{
 const {placeInBar,placeInMenu,reorderBar,barOrder,barKeys,materializeBar}=await helpers();let layout={menu:[item('a'),item('b'),{...item('sep','','separator'),label:''}],menuBar:{top:{actions:[],right:[]},bottom:{actions:['favorite','builtin:settings'],right:['builtin:settings']}}};
 layout=placeInBar(layout,'sep','top');layout=placeInBar(layout,'a','top','item:sep');layout=placeInBar(layout,'b','top',undefined,'right');assert.deepEqual(barOrder(layout.menuBar.top),['item:a','item:sep','item:b']);
 const prior=structuredClone(layout);layout=reorderBar(layout,'item:sep','bottom','builtin:settings','right');assert.deepEqual(prior.menuBar.top.actions,['item:a','item:sep','item:b']);assert.deepEqual(layout.menuBar.top.actions,['item:a','item:b']);assert.deepEqual(barOrder(layout.menuBar.bottom),['favorite','item:sep','builtin:settings']);assert.deepEqual(layout.menuBar.bottom.right,['builtin:settings','item:sep']);assert.equal(barKeys(layout.menuBar).filter(key=>key==='item:sep').length,1);
 layout=reorderBar(layout,'item:b','top','item:a','left');assert.deepEqual(barOrder(layout.menuBar.top),['item:b','item:a']);assert.deepEqual(layout.menuBar.top.right,[]);
 layout=placeInMenu(layout,'item:sep','unused','a','before');assert.equal(layout.menu[0].id,'sep');assert.equal(layout.menu[0].kind,'separator');assert.equal(barKeys(layout.menuBar).includes('item:sep'),false);assert.deepEqual(layout.menuBar.bottom.right,['builtin:settings']);
 layout=materializeBar(layout,'builtin:settings','settings-ref');assert.deepEqual(layout.menuBar.bottom.right,['item:settings-ref']);
 layout.menuBar.top={actions:Array.from({length:7},(_,i)=>'builtin:'+['opened','recent','copy-path','terminal','bookmarks','search','shutdown'][i]),right:[]};const full=structuredClone(layout);assert.throws(()=>reorderBar(layout,'item:settings-ref','top'),/7/);assert.deepEqual(layout,full);
});
