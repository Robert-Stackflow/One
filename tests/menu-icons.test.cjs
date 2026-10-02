const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
test('程序菜单自动读取实际图标，显式指定的图标保持不变',async()=>{
 const bundle=await build({entryPoints:['src/shared/menu-icons.ts','src/shared/search.ts'],bundle:true,platform:'node',format:'cjs',write:false,outdir:'out'});
 const modules=bundle.outputFiles.map(file=>{const m={exports:{}};new Function('module','exports','require',file.text)(m,m.exports,require);return m.exports;});
 const {menuIconPath}=modules.find(m=>m.menuIconPath),{validateMenu}=modules.find(m=>m.validateMenu);
 const item={id:'program',parent:'',kind:'command',label:'Geek',target:'D:\\Portable Program\\Other\\geek.exe',args:[],cwd:'',enabled:true,icon:'file'};
 assert.equal(menuIconPath(item),item.target);
 assert.equal(menuIconPath({...item,icon:'lucide:file'}),item.target);
 assert.equal(menuIconPath({...item,iconMode:'custom'}),undefined);
 assert.equal(menuIconPath({...item,icon:'lucide:coffee'}),undefined);
 assert.equal(menuIconPath({...item,kind:'builtin',target:'terminal',icon:'terminal'}),'one-builtin:terminal');
 for(const [target,icon]of [['environment','settings'],['registry','settings'],['group-policy','settings'],['task-manager','activity']])assert.equal(menuIconPath({...item,kind:'builtin',target,icon}),'one-builtin:'+target);
 assert.equal(menuIconPath({...item,target:'pwsh.exe',icon:'auto'}),'one-program:pwsh.exe');
 assert.equal(menuIconPath({...item,target:'notepad.exe & calc.exe'}),undefined);
 assert.equal(validateMenu([{...item,iconMode:'custom'}])[0].iconMode,'custom');
 assert.throws(()=>validateMenu([{...item,iconMode:'invalid'}]));
});
