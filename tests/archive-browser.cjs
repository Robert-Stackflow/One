const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const JSZip=require('jszip');
const zlib=require('node:zlib');

function duplicateZip(entries){
 const local=[],central=[];let offset=0;
 for(const [name,payload=Buffer.alloc(0)] of entries){const raw=Buffer.from(name),crc=zlib.crc32(payload),header=Buffer.alloc(30),directory=Buffer.alloc(46);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(payload.length,18);header.writeUInt32LE(payload.length,22);header.writeUInt16LE(raw.length,26);
  directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(payload.length,20);directory.writeUInt32LE(payload.length,24);directory.writeUInt16LE(raw.length,28);directory.writeUInt32LE(offset,42);local.push(header,raw,payload);central.push(directory,raw);offset+=header.length+raw.length+payload.length;
 }const end=Buffer.alloc(22),cd=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,cd,end]);
}
function referenceRows(entries,query){
 const rows=new Map();entries.forEach(([name,payload=Buffer.alloc(0)],index)=>{let normalized=name.replaceAll('\\','/');const directory=normalized.endsWith('/');if(query.directory&&(!normalized.startsWith(query.directory)||normalized.length<=query.directory.length))return;if(query.search&&!normalized.toLowerCase().includes(query.search.toLowerCase()))return;
  const entry={type:'entry',index,name,directory,size:payload.length,compressed:payload.length,encrypted:false,implicit:false};
  if(query.flat||query.search){rows.set(normalized+'\0'+index,entry);return;}
  const rest=normalized.slice(query.directory.length),slash=rest.indexOf('/');if(slash<0){if(!rows.has(normalized))rows.set(normalized,entry);return;}
  const folder=query.directory+rest.slice(0,slash+1);if(directory&&slash===rest.length-1)rows.set(folder,entry);else if(!rows.has(folder))rows.set(folder,{type:'entry',index:-1,name:folder,directory:true,size:0,compressed:0,encrypted:false,implicit:true});
 });return [...rows].sort(([a,x],[b,y])=>Number(y.directory)-Number(x.directory)||Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([,entry])=>entry);
}

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-browser-'));let service;
 const helper=path.resolve('dist/native/One.Archive.exe');
 const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
 const text=value=>{const bytes=Buffer.from(value);return Buffer.concat([u32(bytes.length),bytes]);};
 const native=(args,packet=Buffer.alloc(0),password='',expected=0)=>{
  const result=spawnSync(helper,args,{env:{...process.env,ONE_TEST_MODE:'1',TEMP:root,TMP:root},input:Buffer.concat([text(password),packet]),encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  assert.equal(result.status,expected,result.stdout+'\n'+result.stderr+'\n'+result.error);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
 };
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const filename=path.resolve('dist/main/archive-browser-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  service=new mod.exports.ArchiveService(path.join(root,'cache'),()=>{});
  const run=request=>service.run(1,request);
  const source=new JSZip();source.file('隐含目录/deep/data.txt','nested',{createFolders:false});source.file('隐含目录/other.txt','other',{createFolders:false});source.file('Äpfel/FILE.txt','unicode',{createFolders:false});source.folder('empty');
  for(let i=0;i<405;i++)source.file(`root-${String(i).padStart(3,'0')}.txt`,'content '+i);
  source.comment='浏览备注';const zip=path.join(root,'source.zip');await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer'}));
  const query=(directory='',search='',flat=false)=>({directory,search,flat});
  const browse=(browse=query(),offset=0)=>run({operation:'list',path:zip,browse,offset});
  const raw=await run({operation:'list',path:zip});assert.equal(raw.total,409);assert.equal(raw.entries[0].name,'隐含目录/deep/data.txt','raw CLI list order stays unchanged');
  const first=await browse();assert.equal(first.total,409);assert.equal(first.matched,408);assert.equal(first.entries.length,200);assert.equal(first.comment,'浏览备注');
  assert.deepEqual(first.entries.slice(0,3).map(entry=>entry.name),['empty/','Äpfel/','隐含目录/']);assert(first.entries.find(entry=>entry.name==='隐含目录/').implicit);assert.equal(first.entries.find(entry=>entry.name==='隐含目录/').index,-1);
  const last=await browse(query(),400);assert.equal(last.entries.length,8);assert.equal(last.entries.at(-1).name,'root-404.txt');
  const found=await browse(query('','ROOT-404'));assert.equal(found.matched,1);assert.equal(found.entries[0].index,raw.total-1);
  const unicode=await browse(query('','äPFEL'));assert.deepEqual(unicode.entries.map(entry=>entry.name),['Äpfel/FILE.txt']);
  const nested=await browse(query('隐含目录'));assert.deepEqual(nested.entries.map(entry=>entry.name),['隐含目录/deep/','隐含目录/other.txt']);
  const recursive=await browse(query('隐含目录/','DATA'));assert.equal(recursive.matched,1);assert.equal(recursive.entries[0].name,'隐含目录/deep/data.txt');
  const deep=await browse(query('隐含目录/deep/'));assert.equal(deep.entries[0].index,0);
  const flat=await browse(query('','',true));assert.equal(flat.matched,409);assert(flat.entries.some(entry=>entry.name==='隐含目录/deep/data.txt')===false,'flat still paginates the full directory');
  const out=await run({operation:'extract',path:zip,parent:root,selected:[],selectedFolders:['隐含目录/']});
  assert.equal(await fs.readFile(path.join(out.path,'隐含目录/deep/data.txt'),'utf8'),'nested');assert.equal(await fs.readFile(path.join(out.path,'隐含目录/other.txt'),'utf8'),'other');assert.deepEqual(await fs.readdir(out.path),['隐含目录']);
  await assert.rejects(run({operation:'extract',path:zip,parent:root,selectedFolders:['missing/']}),/no longer exists/);assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-extract-')));
  for(const directory of ['../escape','C:/absolute','CON/','/root','bad//path'])await assert.rejects(browse(query(directory)),/目录路径/);
  await assert.rejects(browse(query('','界'.repeat(400))),/过长/);await assert.rejects(browse(query(),-1),/页码/);
  const drag=(folders,selected=[],expected=0)=>{
   const packet=Buffer.concat([u32(selected.length),...selected.map(u32),u32(folders.length),...folders.map(text),Buffer.from([1])]);
   return native(['drag-test',zip,path.join(root,'drag-'+Math.random()),'0',first.revision,'--folders'],packet,'',expected);
  };
  const dropped=drag(['隐含目录/','隐含目录/deep/']);assert.equal(dropped.at(-1).count,1);assert.deepEqual(dropped.filter(line=>line.type==='drag-entry').map(line=>line.name),['隐含目录','隐含目录\\deep','隐含目录\\deep\\data.txt','隐含目录\\other.txt']);
  assert.equal(drag(['隐含目录/deep/'],[raw.total-1]).at(-1).count,2);assert.match(drag(['missing/'],[],2).at(-1).message,/no longer exists/);
  const empty=native(['drag-test',zip,path.join(root,'empty-drag'),'0',first.revision,'--folders'],Buffer.concat([u32(0),u32(1),text('empty/'),Buffer.from([1])])).filter(line=>line.type==='drag-entry');assert(empty[0].directory);assert.equal(empty[0].name,'empty');
  const dir=path.join(root,'中文样本');await fs.mkdir(path.join(dir,'子目录'),{recursive:true});await fs.writeFile(path.join(dir,'子目录','说明.txt'),'hello');
  for(const format of ['7z','tar','tar.gz','tar.xz']){
   const archive=path.join(root,'sample.'+format);await run({operation:'create',path:archive,sources:[dir],password:format==='7z'?' secret ':''});
   const listed=await run({operation:'list',path:archive,password:format==='7z'?' secret ':'',browse:query('','说明')});assert.equal(listed.matched,1);assert.match(listed.entries[0].name,/说明\.txt$/);
   const extracted=await run({operation:'extract',path:archive,parent:root,password:format==='7z'?' secret ':'',selectedFolders:['中文样本/子目录/']});assert.equal(await fs.readFile(path.join(extracted.path,'中文样本/子目录/说明.txt'),'utf8'),'hello');
  }
  for(const format of ['rar4','rar5']){const listed=await run({operation:'list',path:path.resolve(`tests/fixtures/${format}-sample.rar`),browse:query('','',true)});assert.equal(listed.matched,listed.total);}
  const snapshot=await browse();await fs.appendFile(zip,'changed');await assert.rejects(run({operation:'extract',path:zip,parent:root,selected:[0],revision:snapshot.revision}),/changed; reopen/);assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-extract-')));
  const unsafe=new JSZip();unsafe.file('../escape.txt','unsafe',{createFolders:false});const bad=path.join(root,'unsafe.zip');await fs.writeFile(bad,await unsafe.generateAsync({type:'nodebuffer'}));await assert.rejects(run({operation:'list',path:bad,browse:query()}),/unsafe browser/);
  const duplicateEntries=[...Array.from({length:15},()=>['same.txt']),['bucket/child.txt'],['bucket/'],['bucket/'],['slash\\deep\\doc.txt'],['slash/deep/doc.txt'],['Äpfel/FILE.txt'],...Array.from({length:431},(_,i)=>['file-'+String(i*97%431).padStart(4,'0')+'.txt'])];
  const duplicatePath=path.join(root,'duplicates.zip');await fs.writeFile(duplicatePath,duplicateZip(duplicateEntries));
  for(const value of [query(),query('','',true),query('','same'),query('slash/','',true),query('','äPFEL'),query('bucket/')]){
   const expected=referenceRows(duplicateEntries,value),packet=Buffer.concat([text(value.directory),text(value.search),u32(Number(value.flat))]);
   for(const [offset,limit] of [[0,200],[7,200],[200,200],[400,200],[1000,200],[0,0]]){const records=native(['browse',duplicatePath,String(offset),String(limit),'0'],packet),meta=records.find(item=>item.type==='meta');assert.equal(meta.total,duplicateEntries.length);assert.equal(meta.matched,expected.length);assert.deepEqual(records.filter(item=>item.type==='entry'),expected.slice(offset,offset+limit));}
  }
  const unsafeTail=path.join(root,'unsafe-tail.zip');await fs.writeFile(unsafeTail,duplicateZip([...duplicateEntries,['../unsafe.txt']]));
  const tail=native(['browse',unsafeTail,'0','200','0'],Buffer.concat([text(''),text(''),u32(1)]),'',2);assert.equal(tail.filter(item=>item.type==='entry').length,0);assert.equal(tail.at(-1).code,'safety');
  console.log('Archive browser passed: implicit folders, stable original indexes, Unicode recursive search, bounded pages, selective folder extraction/drag, legacy list compatibility, format coverage, duplicates/normalization, 36 independent page comparisons and unsafe tail rejection.');
 }finally{if(service)await service.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
