import {DOMParser,type Element,type Document} from '@xmldom/xmldom';
import {posix} from 'node:path';
import type {Readable} from 'node:stream';
import {open,type Entry,type ZipFile} from 'yauzl';
import {parser as xmlParser,type Tag} from 'sax';
import type {WorkbookData,SheetData,SheetCell} from '../shared/workbook';
const all=(node:Element|Document,name:string)=>Array.from(node.getElementsByTagNameNS('*',name));
const first=(node:Element|Document,name:string)=>all(node,name)[0];
const children=(node:Element)=>Array.from(node.childNodes).filter(n=>n.nodeType===1) as Element[];
const xml=(text:string)=>{if(text.length>24*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('工作表 XML 超出范围');return new DOMParser({onError:(level,message)=>{if(level!=='warning')throw new Error(message);}}).parseFromString(text,'text/xml');};
const limit=24*1024*1024;
async function catalog(path:string):Promise<{zip:ZipFile;entries:Map<string,Entry>}>{
 const zip=await new Promise<ZipFile>((resolve,reject)=>open(path,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(error,value)=>error||!value?reject(error||new Error('无法读取工作簿')):resolve(value)));
 try{
  const entries=await new Promise<Map<string,Entry>>((resolve,reject)=>{
   const result=new Map<string,Entry>();let total=0,count=0;
   const cleanup=()=>{zip.removeListener('error',fail);zip.removeListener('end',done);zip.removeListener('entry',onEntry);};
   const fail=(error:Error)=>{cleanup();reject(error);};
   const done=()=>{cleanup();resolve(result);};
   const onEntry=(entry:Entry)=>{
    if(++count>20000||entry.uncompressedSize>32*1024*1024||(total+=entry.uncompressedSize)>128*1024*1024){fail(new Error('工作簿解压后过大'));return;}
    result.set(entry.fileName,entry);zip.readEntry();
   };
   zip.once('error',fail);zip.once('end',done);
   zip.on('entry',onEntry);
   zip.readEntry();
  });
  return {zip,entries};
 }catch(error){zip.close();throw error;}
}
function readEntry(zip:ZipFile,entry:Entry):Promise<string>{
 if(entry.uncompressedSize>limit)throw new Error('工作表 XML 超出范围');
 return new Promise((resolve,reject)=>{
  let active:{destroy():void}|undefined;
  const cleanup=()=>zip.removeListener('error',onZipError);
  const onZipError=(error:Error)=>{cleanup();active?.destroy();reject(error);};
  zip.once('error',onZipError);
  zip.openReadStream(entry,(error,source)=>{
   if(error||!source){cleanup();reject(error||new Error('无法读取工作表'));return;}
   const chunks:Buffer[]=[];let size=0;
   active=source;
   source.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){source.destroy(new Error('工作表 XML 超出范围'));return;}chunks.push(chunk);});
   source.once('error',error=>{cleanup();reject(error);});
   source.once('end',()=>{cleanup();resolve(Buffer.concat(chunks,size).toString('utf8'));});
   source.once('close',()=>{cleanup();reject(new Error('工作表读取中断'));});
  });
 });
}
async function* streamEntry(zip:ZipFile,entry:Entry):AsyncGenerator<string>{
 if(entry.uncompressedSize>limit)throw new Error('工作表 XML 超出范围');
 const source=await new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error||!value?reject(error||new Error('无法读取工作表')):resolve(value)));
 const decoder=new TextDecoder();let size=0;
 try{
  for await(const part of source){const bytes=part as Buffer;size+=bytes.length;if(size>limit)throw new Error('工作表 XML 超出范围');const text=decoder.decode(bytes,{stream:true});if(text)yield text;}
  const tail=decoder.decode();if(tail)yield tail;
 }finally{source.destroy();}
}
const local=(name:string)=>name.split(':').at(-1)!;
const parser=()=>{const options={trim:false,normalize:false,strictEntities:true},value=xmlParser(true,options);value.onerror=error=>{throw new Error('工作表 XML 无效：'+error.message.split('\n')[0]);};value.ondoctype=()=>{throw new Error('工作表 XML 超出范围');};return value;};
async function sharedStrings(source:AsyncIterable<string>):Promise<string[]>{
 const strings:string[]=[];const xml=parser();let inside=false,inText=false,value='';
 xml.onopentag=(tag:Tag)=>{const name=local(tag.name);if(name==='si'){inside=true;value='';}else if(inside&&name==='t')inText=true;};
 const text=(part:string)=>{if(inside&&inText)value+=part;};xml.ontext=text;xml.oncdata=text;
 xml.onclosetag=name=>{const part=local(name);if(part==='t')inText=false;else if(part==='si'){strings.push(value);inside=false;value='';}};
 for await(const part of source)xml.write(part);xml.close();return strings;
}
async function sheetRows(source:AsyncIterable<string>,sheet:SheetData,strings:string[],format:(value:string,index:number)=>string,add:(sheet:SheetData,number:number,cells:SheetCell[])=>void){
 const xml=parser();let row=0,cells:SheetCell[]=[],cell:{address:string;type:string;style:number;raw:string;formula:string;inline:string}|undefined,field='',stopped=false;
 xml.onopentag=(tag:Tag)=>{const name=local(tag.name);if(name==='row'){row=Number(tag.attributes.r)||sheet.rows.length+1;cells=[];}else if(name==='c'){cell={address:String(tag.attributes.r||''),type:String(tag.attributes.t||''),style:Number(tag.attributes.s||0),raw:'',formula:'',inline:''};}else if(cell&&['v','f','t'].includes(name))field=name;};
 const text=(part:string)=>{if(!cell)return;if(field==='v')cell.raw+=part;else if(field==='f')cell.formula+=part;else if(field==='t')cell.inline+=part;};xml.ontext=text;xml.oncdata=text;
 xml.onclosetag=name=>{const part=local(name);if(['v','f','t'].includes(part))field='';if(part==='c'&&cell){
  const letters=cell.address.match(/^[A-Z]+/i)?.[0]||'';let column=0;for(const c of letters.toUpperCase())column=column*26+c.charCodeAt(0)-64;column--;if(column<0)column=cells.length;
  if(column>=200)sheet.truncated=true;else{const value=cell.type==='s'?strings[Number(cell.raw)]||'':cell.type==='inlineStr'?cell.inline:cell.type==='b'?(cell.raw==='1'?'TRUE':'FALSE'):format(cell.raw,cell.style);if(value||cell.formula)cells.push({column,value:value.slice(0,32768),formula:cell.formula?cell.formula.slice(0,32768):undefined});}cell=undefined;
 }else if(part==='row'){const prior=sheet.rows.length;add(sheet,row,cells);if(sheet.truncated&&sheet.rows.length===prior&&cells.length)stopped=true;cells=[];}};
 for await(const part of source){xml.write(part);if(stopped)break;}if(!stopped)xml.close();
}
async function odsSheets(source:AsyncIterable<string>,add:(sheet:SheetData,number:number,cells:SheetCell[])=>void):Promise<SheetData[]>{
 const sheets:SheetData[]=[],xml=parser(),stack:string[]=[];
 type Table={sheet:SheetData;rowIndex:number;depth:number;stopped:boolean};
 type Row={table:Table;depth:number;repeat:number;column:number;cells:SheetCell[]};
 type Cell={row:Row;depth:number;repeat:number;formula:string|undefined;value:string;date:string;paragraphs:{text:string}[]};
 const tables:Table[]=[],rows:Row[]=[],cells:Cell[]=[],paragraphs:{depth:number;text:string}[]=[];
 xml.onopentag=(tag:Tag)=>{
  const name=local(tag.name);stack.push(name);const depth=stack.length;
  if(name==='table'&&sheets.length<100){const sheet:SheetData={name:String(tag.attributes['table:name']||'工作表'),rows:[],columns:0,truncated:false};sheets.push(sheet);tables.push({sheet,rowIndex:1,depth,stopped:false});}
  else if(name==='table-row'){const table=tables.at(-1);if(table&&!table.stopped)rows.push({table,depth,repeat:Math.min(1_048_576,Number(tag.attributes['table:number-rows-repeated']||1))||1,column:0,cells:[]});}
  else if((name==='table-cell'||name==='covered-table-cell')&&rows.length){const row=rows.at(-1)!;if(depth===row.depth+1)cells.push({row,depth,repeat:Math.min(10000,Number(tag.attributes['table:number-columns-repeated']||1))||1,formula:String(tag.attributes['table:formula']||'')||undefined,value:String(tag.attributes['office:value']||''),date:String(tag.attributes['office:date-value']||''),paragraphs:[]});}
  else if(name==='p'&&cells.length){const cell=cells.at(-1)!;if(depth>cell.depth){const paragraph={depth,text:''};cell.paragraphs.push(paragraph);paragraphs.push(paragraph);}}
 };
 const text=(part:string)=>{for(const paragraph of paragraphs)paragraph.text+=part;};xml.ontext=text;xml.oncdata=text;
 xml.onclosetag=name=>{
  const part=local(name),depth=stack.length;
  if(part==='p'&&paragraphs.at(-1)?.depth===depth)paragraphs.pop();
  else if((part==='table-cell'||part==='covered-table-cell')&&cells.at(-1)?.depth===depth){const cell=cells.pop()!,row=cell.row,repeat=cell.repeat,value=cell.paragraphs.map(p=>p.text).join('\n')||cell.value||cell.date||'';if(value)for(let c=0;c<repeat&&row.column+c<200;c++)row.cells.push({column:row.column+c,value:value.slice(0,32768),formula:cell.formula});if(value&&row.column+repeat>200)row.table.sheet.truncated=true;row.column+=repeat;}
  else if(part==='table-row'&&rows.at(-1)?.depth===depth){const row=rows.pop()!,table=row.table;if(row.cells.length)for(let r=0;r<row.repeat&&!table.sheet.truncated;r++)add(table.sheet,table.rowIndex+r,row.cells);table.rowIndex+=row.repeat;if(table.sheet.truncated)table.stopped=true;}
  else if(part==='table'&&tables.at(-1)?.depth===depth)tables.pop();
  stack.pop();
 };
 for await(const part of source)xml.write(part);xml.close();return sheets;
}
export async function readWorkbook(path:string):Promise<WorkbookData>{
 const {zip,entries}=await catalog(path);
 try{return await parseWorkbook(path,async name=>{const entry=entries.get(name);return entry?xml(await readEntry(zip,entry)):undefined;},name=>{const entry=entries.get(name);return entry?streamEntry(zip,entry):undefined;});}
 finally{zip.close();}
}
async function parseWorkbook(path:string,read:(name:string)=>Promise<Document|undefined>,stream:(name:string)=>AsyncIterable<string>|undefined):Promise<WorkbookData>{
 const sheets:SheetData[]=[];let total=0,characters=0;
 const add=(sheet:SheetData,number:number,cells:SheetCell[])=>{if(!cells.length)return;if(sheet.rows.length>=20000||total+cells.length>100000||characters+cells.reduce((n,c)=>n+c.value.length+(c.formula?.length||0),0)>4_000_000){sheet.truncated=true;return;}total+=cells.length;characters+=cells.reduce((n,c)=>n+c.value.length+(c.formula?.length||0),0);sheet.columns=Math.max(sheet.columns,...cells.map(c=>c.column+1));sheet.rows.push({number,cells});};
 if(path.toLowerCase().endsWith('.ods')){
  const content=stream('content.xml');if(!content)throw new Error('缺少工作表内容');
  return {sheets:await odsSheets(content,add)};
 }
 const workbook=await read('xl/workbook.xml'),relations=await read('xl/_rels/workbook.xml.rels');if(!workbook||!relations)throw new Error('不是有效的 XLSX 工作簿');
 const targets=new Map(all(relations,'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),((r.getAttribute('Target')||'').startsWith('/')?posix.normalize(r.getAttribute('Target')!).slice(1):posix.normalize(posix.join('xl',r.getAttribute('Target')||'')))]));
 const shared=stream('xl/sharedStrings.xml'),strings=shared?await sharedStrings(shared):[];
 const styles=await read('xl/styles.xml'),formats=styles?new Map(all(styles,'numFmt').map(n=>[Number(n.getAttribute('numFmtId')),n.getAttribute('formatCode')||''])):new Map<number,string>();
 const cellXfs=styles&&first(styles,'cellXfs'),styleIds=cellXfs?children(cellXfs).map(x=>Number(x.getAttribute('numFmtId'))):[];const date1904=first(workbook,'workbookPr')?.getAttribute('date1904')==='1';
 const format=(value:string,index:number)=>{const id=styleIds[index]||0,pattern=(formats.get(id)||'').replace(/"[^"]*"|\[[^\]]*\]|\\./g,'');if(!value||!Number.isFinite(Number(value)))return value;const n=Number(value);if(id>=14&&id<=22||/[yd]/i.test(pattern)){const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30),date=new Date(epoch+(n+(!date1904&&n<60?1:0))*86400000);if(!Number.isFinite(date.getTime()))return value;return date.toISOString().slice(0,/[hs]/i.test(pattern)||id>=18&&id<=22?19:10).replace('T',' ');}if(id===9||id===10||pattern.includes('%'))return (n*100).toFixed(id===9?0:2)+'%';if(id===2||id===4)return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:id===4});return value;};
 for(const item of all(workbook,'sheet').slice(0,100)){const target=targets.get(item.getAttribute('r:id')),sheet:SheetData={name:item.getAttribute('name')||'工作表',rows:[],columns:0,truncated:false};sheets.push(sheet);const source=target&&stream(target);if(source)await sheetRows(source,sheet,strings,format,add);
 }return {sheets};
}
