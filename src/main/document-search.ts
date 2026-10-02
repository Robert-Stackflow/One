import {DatabaseSync} from 'node:sqlite';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import type {FileToolTask,FileToolReport,FileToolRow} from '../shared/file-tools';
import type {ToolContext} from './file-tools-engine';
import {walk,extensions,unchanged,stamp,fileExtension,paths} from './file-tool-fs';
import {documentExtensions,documentExtractorVersion,extractDocument} from './document-text';
const escapeLike=(text:string)=>text.replace(/[\\%_]/g,'\\$&');
const chunkSize=16000,overlap=512;
export async function runDocuments(task:FileToolTask,context:ToolContext,report:FileToolReport,rows:FileToolRow[],progress:(phase:string,completed?:number,total?:number,path?:string,bytes?:number,found?:number,force?:boolean)=>void,issue:(path:string,error:unknown)=>void){
 if(task.kind!=='document-index'&&task.kind!=='document-search')throw Error('正文搜索任务无效');report.scope=paths(task.roots);await mkdir(dirname(context.database),{recursive:true});const db=new DatabaseSync(context.database);db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,mtime TEXT,identity TEXT,bytes INTEGER,seen INTEGER); CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(text,path UNINDEXED,page UNINDEXED,line UNINDEXED, tokenize='trigram');");
 try{
  if(task.kind==='document-index'){
   if(!db.prepare('PRAGMA table_info(files)').all().some(column=>column.name==='extractor'))db.exec('ALTER TABLE files ADD COLUMN extractor INTEGER NOT NULL DEFAULT 0');
   const supported=extensions(task.extensions||documentExtensions),seen=Date.now(),roots=paths(task.roots);let indexed=0,cached=0,scanned=0,bytes=0;
   db.exec('PRAGMA temp_store=FILE; CREATE TEMP TABLE document_strings(position INTEGER PRIMARY KEY,value TEXT); PRAGMA temp.cache_size=-2048;');
   const putString=db.prepare('INSERT INTO document_strings(position,value) VALUES(?,?)'),getString=db.prepare('SELECT value FROM document_strings WHERE position=?');
   const sharedStrings={clear:()=>{db.exec('DELETE FROM document_strings');},put:(id:number,text:string)=>{putString.run(id,text);},get:(id:number)=>String(getString.get(id)?.value||'')};
   const previous=db.prepare('SELECT mtime,identity,bytes,extractor FROM files WHERE path=?'),touch=db.prepare('UPDATE files SET seen=? WHERE path=?'),remove=db.prepare('DELETE FROM chunks WHERE path=?'),insert=db.prepare('INSERT INTO chunks(text,path,page,line) VALUES(?,?,?,?)'),finish=db.prepare('INSERT OR REPLACE INTO files(path,mtime,identity,bytes,seen,extractor) VALUES(?,?,?,?,?,?)');
   for await(const file of walk(roots,task.recursive,issue)){
    if(!supported.has(fileExtension(file.path)))continue;scanned++;const old=previous.get(file.path);if(old?.extractor===documentExtractorVersion&&old.mtime===file.mtime&&old.identity===file.identity&&old.bytes===file.size){touch.run(seen,file.path);cached++;progress('检查文档变化',scanned,0,file.path,bytes,indexed);continue;}
    progress('提取文档正文',scanned,0,file.path,bytes,indexed,true);db.exec('BEGIN IMMEDIATE');try{remove.run(file.path);let carry='',lastPage:number|undefined,line=1,phase='提取文档正文';
     for await(const part of extractDocument(file,{sharedStrings,progress:next=>{phase=next;progress(phase,scanned,0,file.path,bytes,indexed);}})){if(lastPage!==part.page&&carry){insert.run(carry,file.path,lastPage??0,line);carry='';}lastPage=part.page;if(!carry)line=part.line??1;carry+=part.text;while(carry.length>=chunkSize){insert.run(carry.slice(0,chunkSize),file.path,part.page??0,line);const consumed=carry.slice(0,chunkSize-overlap);line+=(consumed.match(/\n/g)||[]).length;carry=carry.slice(chunkSize-overlap);}progress(phase,scanned,0,file.path,bytes,indexed);}
     if(!carry.trim()&&fileExtension(file.path)==='pdf'&&!db.prepare('SELECT rowid FROM chunks WHERE path=? LIMIT 1').get(file.path))throw Error('PDF 没有可提取的文字，暂不支持图片 OCR');if(carry.trim())insert.run(carry,file.path,lastPage??0,line);if(!unchanged(file,await stamp(file.path)))throw Error('文档在提取过程中发生变化');finish.run(file.path,file.mtime,file.identity,file.size,seen,documentExtractorVersion);db.exec('COMMIT');indexed++;bytes+=file.size;
    }catch(e){db.exec('ROLLBACK');issue(file.path,e);}
   }
   for(const root of roots){const stale=db.prepare("SELECT path FROM files WHERE seen<>? AND (path=? OR path LIKE ? ESCAPE char(92))").all(seen,root,escapeLike(root.replace(/[\\/]$/,'')+'\\')+'%');db.exec('BEGIN');for(const row of stale){if(!task.recursive&&dirname(String(row.path)).toLowerCase()!==root.toLowerCase())continue;remove.run(row.path);db.prepare('DELETE FROM files WHERE path=?').run(row.path);}db.exec('COMMIT');}
   db.exec('PRAGMA wal_checkpoint(TRUNCATE)');report.stats={recursive:task.recursive?1:0,scanned,indexed,cached,documents:Number(db.prepare('SELECT COUNT(*) AS n FROM files').get()!.n),bytesRead:bytes,indexBytes:(await stat(context.database)).size};report.summary=`${report.stats.documents} 份文档已索引 · 本次更新 ${indexed} 份`;
  }else{
   if(typeof task.query!=='string'||!task.query.trim()||task.query.length>256)throw Error('请输入 1–256 字符的正文关键词');const terms=task.query.trim().toLocaleLowerCase().split(/\s+/),long=terms.filter(t=>[...t].length>=3),conditions=terms.map(()=> 'instr(lower(text),lower(?))>0'),parameters:any[]=[...terms];
   const roots=paths(task.roots),scope=roots.map(root=>{parameters.push(root,escapeLike(root.replace(/[\\/]$/,'')+'\\')+'%');if(task.recursive===false){parameters.push(root.length+2);return '(path=? OR (path LIKE ? ESCAPE char(92) AND instr(substr(path,?),char(92))=0))';}return '(path=? OR path LIKE ? ESCAPE char(92))';}).join(' OR ');let sql=`SELECT path,page,line,text FROM chunks WHERE ${conditions.join(' AND ')} AND (${scope})`;
   if(long.length){sql+=' AND chunks MATCH ?';parameters.push(long.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' AND '));}sql+=' ORDER BY path,page,line';
   const files=new Set<string>(),seen=new Set<string>(),buffer:FileToolRow[]=[];let count=0,page=0;
   for(const item of db.prepare(sql).iterate(...parameters)){
    const text=String(item.text),lower=text.toLocaleLowerCase(),at=lower.indexOf(terms[0]),start=Math.max(0,at-85),end=Math.min(text.length,at+terms[0].length+170),snippet=text.slice(start,end),key=String(item.path)+':'+String(item.page)+':'+snippet;if(seen.has(key))continue;seen.add(key);files.add(String(item.path));buffer.push({id:count++,path:item.path,page:Number(item.page),line:Number(item.line)+(text.slice(0,at).match(/\n/g)||[]).length,snippet,query:task.query});if(buffer.length===100){await writeFile(join(context.dir,`page-${page++}.json`),JSON.stringify(buffer));buffer.length=0;}progress('搜索正文',count,0,String(item.path),0,files.size);
   }
   if(buffer.length)await writeFile(join(context.dir,`page-${page}.json`),JSON.stringify(buffer));report.count=count;report.stats={files:files.size,hits:count,streamed:1};report.summary=`${files.size} 份文档 · ${count} 处匹配`;
  }
 }finally{db.close();}
}
