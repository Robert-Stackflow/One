const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {build}=require('esbuild');

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-folder-edit-'));let service;
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP};
 try{
  Object.assign(process.env,{TEMP:root,TMP:root});
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-update.ts','src/main/archive-cli.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve(`dist/main/${name}-folder-test.cjs`),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{archiveEditPacket}=load('archive-update'),{parseCli,runCli}=load('archive-cli');
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const all=async(file,password)=>{const first=await run({operation:'list',path:file,password});let entries=[...first.entries];for(let offset=200;offset<first.total;offset+=200)entries.push(...(await run({operation:'list',path:file,password,offset})).entries);return {...first,entries:entries.map(item=>({...item,name:item.name.replaceAll('\\','/')}))};};
  const source=path.join(root,'keep.txt');await fs.writeFile(source,'retained contents');
  for(const format of ['zip','7z'])for(const password of ['', ' private 密码 ']){
   const file=path.join(root,(password?'encrypted':'plain')+'.'+format);await run({operation:'create',path:file,sources:[source],password});
   let listing=await all(file,password);
   await run({operation:'update',path:file,revision:listing.revision,password,changes:[
    ...Array.from({length:205},(_,index)=>({kind:'add',source,name:`旧目录/子目录/item${String(index).padStart(3,'0')}.txt`})),
    {kind:'add',source,name:'旧目录/删除/one.txt'},{kind:'add',source,name:'旧目录2/item001.txt'}
   ]});
   listing=await all(file,password);assert.equal(listing.total,208);assert(listing.entries.every(item=>!item.directory));
   const browse=await run({operation:'list',path:file,password,browse:{directory:'',search:'',flat:false}});
   assert(browse.entries.find(item=>item.name==='旧目录/').implicit);assert.equal(browse.entries.find(item=>item.name==='旧目录/').index,-1);
   const first=listing.entries.find(item=>item.name==='旧目录/子目录/item000.txt').index;
   await run({operation:'update',path:file,revision:listing.revision,password,changes:[
    {kind:'rename-folder',folder:'旧目录',name:'新/父'},
    {kind:'rename',index:first,name:'新/父/子目录/first.txt'},
    {kind:'rename-folder',folder:'旧目录/子目录/',name:'新/父/新子'},
    {kind:'delete',indexes:[],folders:['旧目录/删除/','旧目录/删除']},
    {kind:'mkdir',name:'新/父/empty'}
   ]});
   listing=await all(file,password);assert.equal(listing.total,208);assert(listing.entries.some(item=>item.name==='新/父/新子/first.txt'));
   assert(listing.entries.some(item=>item.name==='新/父/新子/item204.txt'),'off-page descendants must follow the folder rename');
   assert(listing.entries.some(item=>item.name==='旧目录2/item001.txt'),'prefix siblings must not be renamed');
   assert.equal(listing.entries.filter(item=>item.directory).length,1,'internal anchors must never become archive headers');
   const bytes=await fs.readFile(file);
   for(const changes of [
    [{kind:'rename-folder',folder:'新/父/新子',name:'旧目录2'}],
    [{kind:'rename-folder',folder:'新/父/empty',name:'旧目录2'}],
    [{kind:'rename-folder',folder:'missing',name:'bad'}],
    [{kind:'delete',indexes:[],folders:['../新']}],
    [{kind:'rename-folder',folder:'keep.txt',name:'bad'}],
    [{kind:'rename-folder',folder:'新/父',name:'../escape'}],
    [{kind:'delete',indexes:[],folders:['']}]
   ]){await assert.rejects(run({operation:'update',path:file,revision:listing.revision,password,changes}));assert.deepEqual(await fs.readFile(file),bytes);}
   if(password){await assert.rejects(run({operation:'update',path:file,revision:listing.revision,password:'wrong',changes:[{kind:'delete',indexes:[],folders:['新/父']}]}));assert.deepEqual(await fs.readFile(file),bytes);}
   // Repeated selectors keep referring to the same folder in this revision,
   // even if an earlier change moves it to a different directory depth.
   await run({operation:'update',path:file,revision:listing.revision,password,changes:[
    {kind:'rename-folder',folder:'新/父',name:'intermediate'},
    {kind:'rename-folder',folder:'新/父',name:'最终'},
    {kind:'rename-folder',folder:'新/父/新子',name:'最终/资料'}
   ]});
   await assert.rejects(run({operation:'update',path:file,revision:listing.revision,password,changes:[{kind:'delete',indexes:[],folders:['新/父']}]}),/changed/);
   listing=await all(file,password);assert(listing.entries.some(item=>item.name==='最终/资料/item204.txt'));
   const extracted=await run({operation:'extract',path:file,parent:root,password});assert.equal(await fs.readFile(path.join(extracted.path,'最终/资料/first.txt'),'utf8'),'retained contents');
   const nested=listing.entries.find(item=>item.name==='最终/资料/first.txt').index;
   await run({operation:'update',path:file,revision:listing.revision,password,changes:[{kind:'delete',indexes:[nested],folders:['最终/资料','最终','最终/资料']} ]});
   listing=await all(file,password);assert.deepEqual(listing.entries.map(item=>item.name).sort(),['keep.txt','旧目录2/item001.txt'].sort());
  }
  // CLI JSON uses the same selectors, including strict field validation.
  const cliArchive=path.join(root,'cli.zip');await run({operation:'create',path:cliArchive,sources:[source]});let listing=await all(cliArchive);
  await run({operation:'update',path:cliArchive,revision:listing.revision,changes:[{kind:'add',source,name:'before/child.txt'}]});
  const changes=path.join(root,'changes.json');await fs.writeFile(changes,JSON.stringify([{kind:'rename-folder',folder:'before',name:'after'}]));
  const invoke=()=>runCli(parseCli(['update','--changes',changes,'--json',cliArchive],root),service,{out:async()=>{},err:async()=>{},signal:new AbortController().signal,password:async()=>''});
  assert.equal(await invoke(),0);assert((await all(cliArchive)).entries.some(item=>item.name==='after/child.txt'));
  // Case-only path spelling is not a collision; selectors ignore case
  // without changing their original identity.
  await fs.writeFile(changes,JSON.stringify([{kind:'rename-folder',folder:'AFTER',name:'After'}]));assert.equal(await invoke(),0);assert((await all(cliArchive)).entries.some(item=>item.name==='After/child.txt'));
  await fs.writeFile(changes,JSON.stringify([{kind:'delete',indexes:[],folders:['after']} ]));assert.equal(await invoke(),0);assert.equal((await all(cliArchive)).total,1);
  await fs.writeFile(changes,JSON.stringify([{kind:'rename-folder',folder:'after',name:'bad',extra:true}]));assert.equal(await invoke(),2);
  listing=await all(cliArchive);await run({operation:'update',path:cliArchive,revision:listing.revision,changes:[{kind:'add',source,name:'Ⱥlpha/child.txt'},{kind:'mkdir',name:'Ⱥexplicit'},{kind:'add',source,name:'ⱥexplicit/child.txt'}]});
  listing=await all(cliArchive);const explicit=listing.entries.find(item=>item.directory).index;
  await run({operation:'update',path:cliArchive,revision:listing.revision,changes:[{kind:'rename-folder',folder:'ⱥlpha',name:'unicode'},{kind:'rename',index:explicit,name:'explicit'}]});
  listing=await all(cliArchive);assert(listing.entries.some(item=>item.name==='unicode/child.txt'));assert(listing.entries.some(item=>item.name==='explicit/child.txt'));
  for(const change of [{kind:'delete',indexes:[],folders:'not-array'},{kind:'delete',indexes:[],folders:[]},{kind:'rename-folder',folder:2,name:'x'},{kind:'rename-folder',folder:'x',name:'\0'}])await assert.rejects(archiveEditPacket([change]));
  assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-')));
  console.log('Archive folder editing passed: implicit ZIP/7Z directories, encryption, off-page descendants, ordered parent/child moves, stable selectors, overlap deletes, collision/stale/unsafe rollback, CLI JSON and no synthetic headers.');
 }finally{
  await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
