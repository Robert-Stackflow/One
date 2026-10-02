const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild');
async function moduleFor(file,loader=require){const bundle=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const m={exports:{}};new Function('module','exports','require','__dirname',bundle.outputFiles[0].text)(m,m.exports,loader,process.cwd());return m.exports;}
test('One 目录命令使用真实当前目录，占用优先选中项；无路径与虚拟位置只打开页面',async()=>{
 const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit');await fs.mkdir(out,{recursive:true});const root=await fs.mkdtemp(path.join(out,'one-context-')),folder=path.join(root,'当前 目录 & $()'),file=path.join(folder,'选中 中文.txt');await fs.mkdir(folder);await fs.writeFile(file,'fixture');
 const {oneMenuTarget}=await moduleFor('src/main/one-menu-target.ts'),{builtinById}=await moduleFor('src/shared/menu-builtins.ts'),context={kind:'menu',hwnd:0,pid:0,created:'',folders:[{path:root,hwnd:1,active:false}],currentFolder:folder,selected:[file]};
 for(const [id,page]of [['space-analysis','disk'],['file-tools','tools']])assert.deepEqual(await oneMenuTarget(builtinById(id),context),{page,folder});
 assert.deepEqual(await oneMenuTarget(builtinById('file-locks'),{...context,selected:[file,file.toUpperCase(),folder,path.join(root,'deleted')]}),{page:'locksmith',paths:[file,folder]});
 assert.deepEqual(await oneMenuTarget(builtinById('file-locks'),{...context,selected:[]}),{page:'locksmith',paths:[folder]});
 assert.deepEqual(await oneMenuTarget(builtinById('file-locks'),{...context,selected:[path.join(root,'deleted')]}),{page:'locksmith',paths:[folder]});
 for(const currentFolder of [undefined,'shell:Downloads',path.join(root,'deleted'),file,'relative',folder+'\0'])for(const [id,page]of [['space-analysis','disk'],['file-tools','tools'],['file-locks','locksmith']])assert.deepEqual(await oneMenuTarget(builtinById(id),{...context,currentFolder,selected:[]}),{page});
 assert.deepEqual(await oneMenuTarget(builtinById('main-window'),context),{page:'home'});assert.deepEqual(await oneMenuTarget(builtinById('text-tools'),context),{page:'text'});assert.equal(await oneMenuTarget(builtinById('pick-color'),context),undefined);
 await assert.rejects(()=>oneMenuTarget(builtinById('file-locks'),{...context,selected:Array.from({length:33},(_,i)=>path.join(folder,String(i)))}),/32/);
});
test('One 操作栏与菜单行使用执行时上下文，并保留执行快照',async()=>{
 const {SearchMenu}=await moduleFor('src/main/search-menu.ts',id=>id==='electron'?{shell:{},clipboard:{}}:require(id)),{defaultSearch}=await moduleFor('src/shared/search.ts'),config=defaultSearch(),calls=[];
 config.menu=[{id:'disk',parent:'',label:'空间分析',kind:'builtin',target:'space-analysis',args:[],cwd:'',icon:'disk',enabled:true}];config.menuBar={top:{actions:['builtin:space-analysis'],right:[]},bottom:{actions:[],right:[]}};
 const menu=new SearchMenu('work/current/unit/nonexistent-context-history.json',()=>config,{},()=>{},()=>{},undefined,undefined,undefined,(command,context)=>calls.push({command,context}));
 const initial={kind:'menu',hwnd:1,pid:1,created:'old',folders:[],currentFolder:'C:\\old'};const nodes=await menu.open(initial),bars=menu.toolbar();
 const updated={...initial,created:'fresh',currentFolder:'D:\\current',selected:['D:\\current\\file.txt'],folders:[{path:'D:\\current',hwnd:1,active:true}]};menu.updateContext(updated);
 await menu.execute(nodes[0].id);await menu.execute(bars.top[0].id);
 updated.currentFolder='E:\\next';updated.selected.push('E:\\next\\other');updated.folders[0].path='E:\\next';
 for(const {command,context}of calls){assert.equal(command.id,'space-analysis');assert.equal(context.currentFolder,'D:\\current');assert.equal(context.created,'fresh');assert.deepEqual(context.selected,['D:\\current\\file.txt']);assert.equal(context.folders[0].path,'D:\\current');}
});
