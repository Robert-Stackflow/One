const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip'),{buildSync}=require('esbuild');
const base=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work','document-search-tests');let root,service;const signals=[];
test.before(async()=>{await fs.mkdir(base,{recursive:true});root=await fs.mkdtemp(path.join(base,'transaction-'));const module=path.join(base,'service.cjs');buildSync({entryPoints:['src/main/file-tools-service.ts'],outfile:module,bundle:true,platform:'node',target:'node22'});await fs.copyFile('dist/main/file-tools-worker.cjs',path.join(base,'file-tools-worker.cjs'));const {FileToolsService}=require(module);service=new FileToolsService(path.join(root,'cache'),(_,p)=>signals.push(p));});
test.after(async()=>service?.stop());
const run=task=>service.run(7,task),index=folder=>run({kind:'document-index',roots:[folder],recursive:true,extensions:''});
async function hits(folder,query){const report=await run({kind:'document-search',roots:[folder],query});return service.page(report.id,0);}
async function word(file,text){const z=new JSZip();z.file('word/document.xml','<w:document xmlns:w="urn:w"><w:body>'+text+'</w:body></w:document>');await fs.writeFile(file,await z.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:1}}));}
function pdf(marker,pages=1){let text='%PDF-1.4\n',offsets=[0];const obj=(id,body)=>{offsets[id]=Buffer.byteLength(text);text+=`${id} 0 obj\n${body}\nendobj\n`;};obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${4+2*i} 0 R`).join(' ')}] /Count ${pages} >>`);obj(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');for(let i=0;i<pages;i++){obj(4+2*i,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+2*i} 0 R >>`);const content=`BT /F1 12 Tf 30 700 Td (${marker}_${i+1}) Tj ET\n`;obj(5+2*i,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);}const xref=Buffer.byteLength(text);return text+`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;}
async function cancelWhen(folder,phase){const start=signals.length,result=index(folder).then(report=>({report}),error=>({error:String(error)}));const deadline=Date.now()+10000;while(!signals.slice(start).some(p=>p.phase.includes(phase))){assert.ok(Date.now()<deadline,'expected extraction progress');await new Promise(r=>setTimeout(r,5));}const at=performance.now();service.cancel(7,'document-index');const stopped=await result;assert.match(stopped.error,/任务已停止/);while(service.pendingTasks)await new Promise(r=>setTimeout(r,5));assert.ok(performance.now()-at<1000,'cancellation and worker cleanup exceeded one second');}
test('Cancelling Word extraction rolls back the old index and a retry completes correctly',async()=>{
 const folder=path.join(root,'word');await fs.mkdir(folder);const file=path.join(folder,'document.docx');await word(file,'<w:p><w:r><w:t>OLD_WORD_CONTENT</w:t></w:r></w:p>');assert.equal((await index(folder)).stats.indexed,1);
 await word(file,Array.from({length:70000},(_,i)=>`<w:p><w:r><w:t>paragraph ${i} ${'document content '.repeat(5)} ${i===69999?'NEW_WORD_CONTENT':''}</w:t></w:r></w:p>`).join(''));await cancelWhen(folder,'提取 Office 正文');assert.equal((await hits(folder,'OLD_WORD_CONTENT')).length,1);assert.equal((await hits(folder,'NEW_WORD_CONTENT')).length,0);assert.equal((await index(folder)).stats.indexed,1);assert.equal((await hits(folder,'NEW_WORD_CONTENT'))[0].line,70000);assert.equal((await hits(folder,'OLD_WORD_CONTENT')).length,0);
});
test('Cancelling PDF extraction preserves the previous version and frees resources for a complete retry',async()=>{
 const folder=path.join(root,'pdf');await fs.mkdir(folder);const file=path.join(folder,'document.pdf');await fs.writeFile(file,pdf('OLD_PDF'));assert.equal((await index(folder)).stats.indexed,1);await fs.writeFile(file,pdf('NEW_PDF',600));await cancelWhen(folder,'提取 PDF 正文');const moved=file+'.moved';await fs.rename(file,moved);await fs.rename(moved,file);assert.equal((await hits(folder,'OLD_PDF')).length,1);assert.equal((await hits(folder,'NEW_PDF_600')).length,0);assert.equal((await index(folder)).stats.indexed,1);assert.equal((await hits(folder,'NEW_PDF_600'))[0].page,600);
});
test('Malformed and textless PDF files are reported while valid neighbors remain searchable',async()=>{
 const folder=path.join(root,'invalid');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'broken.pdf'),'%PDF-1.4\nnot a valid document');await fs.writeFile(path.join(folder,'empty.pdf'),pdf('').replace(/\(_1\)/,'(  )'));await fs.writeFile(path.join(folder,'valid.pdf'),pdf('VALID_NEIGHBOR'));const report=await index(folder);assert.equal(report.stats.indexed,1);assert.equal(report.issueCount,2);assert.ok(report.issues.some(i=>i.error.includes('OCR')));assert.equal((await hits(folder,'VALID_NEIGHBOR')).length,1);for(const name of ['broken.pdf','empty.pdf']){const file=path.join(folder,name);await fs.rename(file,file+'.moved');await fs.rename(file+'.moved',file);}assert.equal((await index(folder)).stats.cached,1);
});
test('Updating a legacy index refreshes unchanged files once and then reuses the new extraction cache',async()=>{
 const folder=path.join(root,'legacy');await fs.mkdir(folder);const file=path.join(folder,'document.docx');await word(file,'<w:p><w:r><w:t>CURRENT_EXTRACTOR_TEXT</w:t></w:r></w:p>');await index(folder);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(root,'cache','documents.sqlite'));try{db.prepare('UPDATE chunks SET text=? WHERE path=?').run('STALE_EXTRACTOR_TEXT',file);db.exec('ALTER TABLE files DROP COLUMN extractor');}finally{db.close();}
 assert.equal((await hits(folder,'STALE_EXTRACTOR_TEXT')).length,1);const updated=await index(folder);assert.equal(updated.stats.indexed,1);assert.equal(updated.stats.cached,0);assert.equal((await hits(folder,'CURRENT_EXTRACTOR_TEXT')).length,1);assert.equal((await hits(folder,'STALE_EXTRACTOR_TEXT')).length,0);const cached=await index(folder);assert.equal(cached.stats.indexed,0);assert.equal(cached.stats.cached,1);
});

test('Legacy chunk ownership migrates once, updates exact files and retains failed versions within a batch',async()=>{
 const folder=path.join(root,'owners');await fs.mkdir(folder);const count=140;
 for(let i=0;i<count;i++)await fs.writeFile(path.join(folder,`entry-${i}.txt`),`OWNER_BODY_${i}_END `+'complete paragraph '.repeat(1300));
 assert.equal((await index(folder)).stats.indexed,count);
 const {DatabaseSync}=require('node:sqlite'),database=path.join(root,'cache','documents.sqlite');
 let db=new DatabaseSync(database);try{db.exec('DROP TABLE document_chunks');}finally{db.close();}
 await fs.writeFile(path.join(folder,'entry-0.txt'),'REPLACED_OWNER_ZERO');await fs.writeFile(path.join(folder,'entry-1.txt'),'REPLACED_OWNER_ONE');await fs.unlink(path.join(folder,'entry-2.txt'));await fs.writeFile(path.join(folder,'entry-3.txt'),Buffer.from([1,0,3,0]));
 const update=await index(folder);assert.equal(update.stats.indexed,2);assert.equal(update.stats.cached,count-4);assert.equal(update.issueCount,1);
 assert.equal((await hits(folder,'REPLACED_OWNER_ZERO')).length,1);assert.equal((await hits(folder,'OWNER_BODY_0_END')).length,0);assert.equal((await hits(folder,'OWNER_BODY_2_END')).length,0);assert.equal((await hits(folder,'OWNER_BODY_3_END')).length,1);
 db=new DatabaseSync(database);try{
  assert.equal(db.prepare('SELECT count(*) AS n FROM chunks c LEFT JOIN document_chunks d ON c.rowid=d.chunk WHERE d.chunk IS NULL OR c.path<>d.path').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM document_chunks d LEFT JOIN chunks c ON c.rowid=d.chunk WHERE c.rowid IS NULL').get().n,0);
 }finally{db.close();}
 await fs.writeFile(path.join(folder,'entry-3.txt'),'REPAIRED_OWNER_THREE');const repaired=await index(folder);assert.equal(repaired.stats.indexed,1);assert.equal(repaired.issueCount,0);assert.equal((await hits(folder,'REPAIRED_OWNER_THREE')).length,1);assert.equal((await hits(folder,'OWNER_BODY_3_END')).length,0);
});

test('Removing scoped stale documents preserves other scopes and nested files during a nonrecursive update',async()=>{
 const folder=path.join(root,'scoped'),nested=path.join(folder,'nested'),other=path.join(root,'separate');await fs.mkdir(nested,{recursive:true});await fs.mkdir(other);
 const top=path.join(folder,'top.txt'),child=path.join(nested,'child.txt'),outside=path.join(other,'other.txt');await fs.writeFile(top,'SCOPED_TOP');await fs.writeFile(child,'SCOPED_CHILD');await fs.writeFile(outside,'OTHER_SCOPE');await index(folder);await index(other);
 await fs.unlink(top);await fs.unlink(child);await run({kind:'document-index',roots:[folder],recursive:false,extensions:''});
 assert.equal((await hits(folder,'SCOPED_TOP')).length,0);assert.equal((await hits(folder,'SCOPED_CHILD')).length,1);assert.equal((await hits(other,'OTHER_SCOPE')).length,1);
 await index(folder);assert.equal((await hits(folder,'SCOPED_CHILD')).length,0);assert.equal((await hits(other,'OTHER_SCOPE')).length,1);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(root,'cache','documents.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM document_chunks WHERE path=? OR path=?').get(top,child).n,0);}finally{db.close();}
});

test('Small probe reuse and streamed text preserve encoded Unicode, BOMs and final line positions',async()=>{
 const folder=path.join(root,'encoded'),iconv=require('iconv-lite');await fs.mkdir(folder);
 for(const encoding of ['utf8','gbk','utf16le','utf16be'])for(const large of [false,true]){
  const marker='ENCODED_'+encoding+'_COMPLETE',ending='ENDING_'+encoding+'_COMPLETE',text=marker+' 中文\n'+(large?'正文内容\n'.repeat(12000):'')+ending;
  let body=iconv.encode(text,encoding);if(encoding==='utf8')body=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),body]);if(encoding==='utf16le')body=Buffer.concat([Buffer.from([0xff,0xfe]),body]);if(encoding==='utf16be')body=Buffer.concat([Buffer.from([0xfe,0xff]),body]);
  await fs.writeFile(path.join(folder,encoding+(large?'-large':'-small')+'.txt'),body);
 }
 await fs.writeFile(path.join(folder,'empty.txt'),'');const report=await index(folder);assert.equal(report.stats.indexed,9);assert.equal(report.issueCount,0);
 for(const encoding of ['utf8','gbk','utf16le','utf16be']){
  const start=await hits(folder,'ENCODED_'+encoding+'_COMPLETE'),end=await hits(folder,'ENDING_'+encoding+'_COMPLETE');assert.equal(start.length,2);assert.ok(start.every(row=>row.line===1&&row.snippet.includes('中文')));assert.equal(end.length,2);assert.equal(end.find(row=>row.path.endsWith('-large.txt')).line,12002);assert.equal(end.find(row=>row.path.endsWith('-small.txt')).line,2);
 }
});
