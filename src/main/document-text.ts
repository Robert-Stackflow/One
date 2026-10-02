import {readFile,open as openFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {extname} from 'node:path';
import iconv from 'iconv-lite';
import type {FileStamp} from '../shared/file-tools';
export const documentExtensions='txt log md markdown rtf html htm json yaml yml xml csv tsv ini toml py js ts jsx tsx css scss sql rs go java c cpp h sh ps1 properties conf cfg docx pptx xlsx xlsm ods odt epub pdf';
export interface DocumentPart {text:string;page?:number;line?:number}
export const documentExtractorVersion=1;
export interface DocumentOptions {
 progress?:(phase:string)=>void;
 sharedStrings?:{clear():void;put(index:number,text:string):void;get(index:number):string};
}
function htmlText(text:string){return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<\/(p|div|h[1-6]|li|tr)>|<br\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,s=>{const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};if(named[s])return named[s];const n=parseInt(s.slice(s.startsWith('&#x')?3:2,-1),s.startsWith('&#x')?16:10);return Number.isFinite(n)&&n<=0x10ffff?String.fromCodePoint(n):s;});}
export async function* extractDocument(file:FileStamp,options:DocumentOptions={}):AsyncGenerator<DocumentPart>{
 const ext=extname(file.path).slice(1).toLowerCase();if(['docx','pptx','xlsx','xlsm','ods','odt','epub'].includes(ext)){
  if(file.size>50*1024*1024)throw Error('Office/电子书文件超过 50 MB');const {extractOffice,extractEbook}=await import('./office-text');
  if(ext==='epub')yield* extractEbook(file.path,options,htmlText);else yield* extractOffice(file.path,ext,options);return;
 }
 if(ext==='pdf'){
  if(file.size>100*1024*1024)throw Error('PDF 超过 100 MB');const {extractPdf}=await import('./pdf-text');yield* extractPdf(file,options);return;
 }
 if(file.size>100*1024*1024)throw Error('文本文件超过 100 MB');const handle=await openFile(file.path,'r');let encoding='utf8',sample:Buffer,complete=false;try{const probe=Buffer.allocUnsafe(Math.min(file.size,64*1024)),read=await handle.read(probe,0,probe.length,0);sample=probe.subarray(0,read.bytesRead);complete=read.bytesRead===file.size;if(sample[0]===0xff&&sample[1]===0xfe)encoding='utf16le';else if(sample[0]===0xfe&&sample[1]===0xff)encoding='utf16be';else try{new TextDecoder('utf-8',{fatal:true}).decode(sample,{stream:true});}catch{encoding='gbk';}if(encoding==='utf8'&&sample.includes(0))throw Error('无法识别为文本文件');}finally{await handle.close();}
 if(ext==='html'||ext==='htm'||ext==='rtf'){if(file.size>20*1024*1024)throw Error('HTML/RTF 超过 20 MB');let text=iconv.decode(complete?sample:await readFile(file.path),encoding);if(ext==='rtf')text=text.replace(/\\u(-?\d+)\??/g,(_,n:string)=>String.fromCharCode((Number(n)+65536)%65536)).replace(/\\'[0-9a-f]{2}/gi,s=>iconv.decode(Buffer.from(s.slice(2),'hex'),'gbk')).replace(/\\par\b|\\line\b/g,'\n').replace(/\\[a-z]+-?\d* ?|[{}]/gi,'');else text=htmlText(text);yield{text,line:1};return;}
 // Most notes and source files fit in the encoding probe. Reuse those bytes
 // instead of opening a second handle and constructing a stream per small file.
 if(complete){yield{text:iconv.decode(sample,encoding),line:1};return;}
 const decoder=iconv.getDecoder(encoding),stream=createReadStream(file.path,{highWaterMark:64*1024});let line=1;for await(const bytes of stream){const text=decoder.write(bytes as Buffer);yield{text,line};line+=(text.match(/\n/g)||[]).length;}const tail=decoder.end();if(tail)yield{text:tail,line};
}
