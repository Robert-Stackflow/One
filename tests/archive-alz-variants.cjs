const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {spawn}=require('node:child_process');
const {build}=require('esbuild');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const u32=value=>{const data=Buffer.alloc(4);data.writeUInt32LE(value);return data;};
async function load(){const result=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-alz-variants-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function native(args,password='',tail=Buffer.alloc(0)){
 return new Promise((resolve,reject)=>{const child=spawn(path.resolve('dist/native/One.Archive.exe'),args,{windowsHide:true,env:{...process.env,ONE_TEST_MODE:'1'}});let stdout='';const timer=setTimeout(()=>child.kill(),60000);child.stdout.on('data',data=>stdout+=data);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,events:stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))});});child.stdin.on('error',()=>{});const data=Buffer.from(password);child.stdin.end(Buffer.concat([u32(data.length),data,tail]));});
}
function positions(data){
 const result=[];let offset=8;
 while(data.readUInt32LE(offset)===0x015a4c42){const header=offset,length=data.readUInt16LE(offset+4),flags=data[offset+11],width=flags>>4;offset+=13;let packed=0;
  if(width){offset+=6;packed=Number(data.readUIntLE(offset,width));offset+=width*2;}offset+=length;
  const secret=offset;if(flags&1)offset+=12;const payload=offset;offset+=packed;result.push({header,flags,secret,payload,packed});
 }return result;
}
async function split(base,data,cuts){
 const payload=data.subarray(8,-16),points=[0,...cuts,payload.length];const files=[];
 for(let i=0;i+1<points.length;i++){const header=Buffer.from(data.subarray(0,8));header.writeUInt16LE(i,6);const footer=Buffer.from(data.subarray(-16));if(i+2<points.length)footer[15]=3;
  const file=base+(i?'.a'+String(i-1).padStart(2,'0'):'.alz');await fs.writeFile(file,Buffer.concat([header,payload.subarray(points[i],points[i+1]),footer]));files.push(file);
 }return files;
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-alz-variants-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;
 try{
  const {ArchiveService}=await load();service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request),browse={directory:'',search:'',flat:true},folder=path.resolve('tests/fixtures/archives/alz-variants'),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  for(const item of [...manifest.external,...manifest.generated]){
   const data=await fs.readFile(path.join(folder,item.name));assert.equal(data.length,item.bytes);assert.equal(hash(data),item.sha256);const source=path.join(root,item.name);await fs.writeFile(source,data);const request={path:source,encoding:949,password:item.password};checks++;
   const listing=await run({...request,operation:'list',browse});assert.equal(listing.editable,false);assert.equal(listing.total,item.expected.length);assert.deepEqual(listing.entries.filter(x=>!x.directory).map(x=>x.name.replace(/\\/g,'/')).sort(),item.expected.filter(x=>!x.directory).map(x=>x.name).sort());checks++;
   const first=listing.entries.find(x=>!x.directory);assert(first);const details=await run({...request,operation:'details',index:first.index,revision:listing.revision});assert.equal(details.details.entry.size,first.size);checks++;
   assert.equal((await run({...request,operation:'test'})).count,item.expected.length);checks++;
   const output=path.join(root,item.name+'.out');await fs.mkdir(output);const extraction={...request,operation:'extract',parent:output,destination:'here'};let extracted=await run(extraction);
   if(extracted.risk){assert.equal(extracted.count,0);assert.deepEqual(await fs.readdir(output),[]);extracted=await run({...extraction,riskApproval:{revision:extracted.risk.revision,maxBytes:64*1024**3,maxMilliseconds:30*60000}});checks++;}
   assert(extracted.count>=item.expected.length,item.name+' published count');
   for(const entry of item.expected){const target=path.join(output,entry.name);if(entry.directory){assert((await fs.stat(target)).isDirectory());continue;}const plain=await fs.readFile(target).catch(async error=>{error.message+='; outputs='+JSON.stringify((await fs.readdir(output,{recursive:true})).slice(0,20));throw error;});assert.equal(plain.length,entry.bytes);assert.equal(hash(plain),entry.sha256,item.name+':'+entry.name);}checks++;
   if(item.password){for(const password of ['','wrong'])await assert.rejects(run({...request,operation:'test',password}),error=>error.code==='password');checks+=2;}
  }
  const date=await fs.readFile(path.join(folder,'date-all.alz')),empty=await fs.readFile(path.join(folder,'empty-date.alz')),legacy=await fs.readFile(path.join(folder,'enc_store.alz'));
  const mutations=[];
  for(const [name,data,password] of [['date',date,'secret'],['empty',empty,'secret'],['legacy',legacy,'test1234']]){
   const position=positions(data)[0];
   for(const [label,offset,bit] of [['check-mode',position.header+11,8],['check-byte',position.secret+11,1],...(name==='legacy'?[]:[['time-check-byte',position.header+8,1]])]){
    const bytes=Buffer.from(data);bytes[offset]^=bit;mutations.push([name+'-'+label,bytes,password]);
   }
  }
  const emptyPosition=positions(empty)[0],directory=Buffer.from(empty);directory[emptyPosition.header+6]|=16;mutations.push(['encrypted-directory',directory,'secret']);
  mutations.push(['truncated-crypto',empty.subarray(0,emptyPosition.secret+11),'secret'],['empty-extra-payload',Buffer.concat([empty.subarray(0,-16),Buffer.from([1]),empty.subarray(-16)]),'secret']);
  const corrupt=Buffer.from(date);corrupt[positions(date)[0].payload]^=1;mutations.push(['date-body-crc',corrupt,'secret']);
  for(const [name,data,password] of mutations){const source=path.join(root,name+'.alz'),output=path.join(root,name+'.out');await fs.writeFile(source,data);await fs.mkdir(output);await fs.writeFile(path.join(output,'keep.txt'),'preserve');
   await assert.rejects(run({operation:'test',path:source,password}));await assert.rejects(run({operation:'extract',path:source,password,parent:output,destination:'here'}));assert.deepEqual(await fs.readdir(output),['keep.txt']);assert.equal(await fs.readFile(path.join(output,'keep.txt'),'utf8'),'preserve');checks+=2;
  }
  // Only the DOS-time high byte participates in the date password check.
  const otherDate=Buffer.from(empty);otherDate[emptyPosition.header+9]^=128;const otherPath=path.join(root,'date-other-byte.alz');await fs.writeFile(otherPath,otherDate);assert.equal((await run({operation:'test',path:otherPath,password:'secret'})).count,1);checks++;
  const mixed=await fs.readFile(path.join(folder,'mixed.alz')),offsets=positions(mixed);const volumes=await split(path.join(root,'mixed-split'),mixed,[offsets[0].secret+5-8,offsets[1].payload+1-8]);
  for(const source of volumes){const listing=await run({operation:'list',path:source,browse});assert.equal(listing.total,4);assert.equal((await run({operation:'test',path:source,password:'secret'})).count,4);checks+=2;}
  for(const [name,index] of [['mixed.alz',1],['empty-date.alz',0],['empty-crc.alz',0]]){const source=path.join(root,name),listing=await run({operation:'list',path:source,browse});const drag=await native(['drag-test',source,path.join(root,name+'.drag'),'0',listing.revision],'secret',Buffer.concat([u32(1),u32(index),Buffer.from([1])]));assert.equal(drag.code,0,JSON.stringify(drag.events));assert.equal(drag.events.filter(x=>x.type==='drag-entry').length,1);checks++;}
  const evidence=path.resolve('verification/archive-alz-variants');await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'latest.json'),JSON.stringify({date:new Date().toISOString(),checks,externalArchives:manifest.external.length,generatedArchives:manifest.generated.length,entries:manifest.external.concat(manifest.generated).reduce((sum,item)=>sum+item.expected.length,0),referenceCommit:manifest.commit,reference:manifest.reference,coverage:'Per-member date/CRC checks; complete DOS date; encrypted Store/Deflate/BZh empty files; exact hashes; missing/wrong passwords; no mode fallback; encrypted directory/truncation/unexpected payload/body CRC rejection; preserved destination; split cipher boundaries and drag.'},null,2)+'\n');
  console.log(`ALZ variants passed: ${checks} checks, 19 archives, exact hashes, per-member date/CRC, encrypted empty files, split boundaries, drag and hostile variants.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
