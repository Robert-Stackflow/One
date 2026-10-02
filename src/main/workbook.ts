import JSZip from 'jszip';
import {DOMParser,type Element,type Document} from '@xmldom/xmldom';
import {readFile} from 'node:fs/promises';
import {posix} from 'node:path';
import type {WorkbookData,SheetData,SheetCell} from '../shared/workbook';
const all=(node:Element|Document,name:string)=>Array.from(node.getElementsByTagNameNS('*',name));
const first=(node:Element|Document,name:string)=>all(node,name)[0];
const children=(node:Element)=>Array.from(node.childNodes).filter(n=>n.nodeType===1) as Element[];
const xml=(text:string)=>{if(text.length>24*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('工作表 XML 超出范围');return new DOMParser({onError:(level,message)=>{if(level!=='warning')throw new Error(message);}}).parseFromString(text,'text/xml');};
export async function readWorkbook(path:string):Promise<WorkbookData>{
 const zip=await JSZip.loadAsync(await readFile(path));const read=async(name:string)=>{const file=zip.file(name);return file?xml(await file.async('string')):undefined;};
 const sheets:SheetData[]=[];let total=0,characters=0;
 const add=(sheet:SheetData,number:number,cells:SheetCell[])=>{if(!cells.length)return;if(sheet.rows.length>=20000||total+cells.length>100000||characters+cells.reduce((n,c)=>n+c.value.length+(c.formula?.length||0),0)>4_000_000){sheet.truncated=true;return;}total+=cells.length;characters+=cells.reduce((n,c)=>n+c.value.length+(c.formula?.length||0),0);sheet.columns=Math.max(sheet.columns,...cells.map(c=>c.column+1));sheet.rows.push({number,cells});};
 if(path.toLowerCase().endsWith('.ods')){
  const content=await read('content.xml');if(!content)throw new Error('缺少工作表内容');
  for(const table of all(content,'table').slice(0,100)){const sheet:SheetData={name:table.getAttribute('table:name')||'工作表',rows:[],columns:0,truncated:false};sheets.push(sheet);let rowIndex=1;
   for(const row of all(table,'table-row')){let col=0;const cells:SheetCell[]=[];for(const cell of children(row)){if(!['table-cell','covered-table-cell'].includes(cell.localName||''))continue;const repeat=Math.min(10000,Number(cell.getAttribute('table:number-columns-repeated')||1))||1;const value=all(cell,'p').map(p=>p.textContent).join('\n')||cell.getAttribute('office:value')||cell.getAttribute('office:date-value')||'';if(value)for(let c=0;c<repeat&&col+c<200;c++)cells.push({column:col+c,value:value.slice(0,32768),formula:cell.getAttribute('table:formula')||undefined});if(value&&col+repeat>200)sheet.truncated=true;col+=repeat;}const repeat=Math.min(1_048_576,Number(row.getAttribute('table:number-rows-repeated')||1))||1;if(cells.length)for(let r=0;r<repeat&&!sheet.truncated;r++)add(sheet,rowIndex+r,cells);rowIndex+=repeat;if(sheet.truncated)break;}
  }return {sheets};
 }
 const workbook=await read('xl/workbook.xml'),relations=await read('xl/_rels/workbook.xml.rels');if(!workbook||!relations)throw new Error('不是有效的 XLSX 工作簿');
 const targets=new Map(all(relations,'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),((r.getAttribute('Target')||'').startsWith('/')?posix.normalize(r.getAttribute('Target')!).slice(1):posix.normalize(posix.join('xl',r.getAttribute('Target')||'')))]));
 const shared=await read('xl/sharedStrings.xml'),strings=shared?all(shared,'si').map(si=>all(si,'t').map(t=>t.textContent).join('')):[];
 const styles=await read('xl/styles.xml'),formats=styles?new Map(all(styles,'numFmt').map(n=>[Number(n.getAttribute('numFmtId')),n.getAttribute('formatCode')||''])):new Map<number,string>();
 const cellXfs=styles&&first(styles,'cellXfs'),styleIds=cellXfs?children(cellXfs).map(x=>Number(x.getAttribute('numFmtId'))):[];const date1904=first(workbook,'workbookPr')?.getAttribute('date1904')==='1';
 const format=(value:string,index:number)=>{const id=styleIds[index]||0,pattern=(formats.get(id)||'').replace(/"[^"]*"|\[[^\]]*\]|\\./g,'');if(!value||!Number.isFinite(Number(value)))return value;const n=Number(value);if(id>=14&&id<=22||/[yd]/i.test(pattern)){const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30),date=new Date(epoch+(n+(!date1904&&n<60?1:0))*86400000);if(!Number.isFinite(date.getTime()))return value;return date.toISOString().slice(0,/[hs]/i.test(pattern)||id>=18&&id<=22?19:10).replace('T',' ');}if(id===9||id===10||pattern.includes('%'))return (n*100).toFixed(id===9?0:2)+'%';if(id===2||id===4)return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:id===4});return value;};
 for(const item of all(workbook,'sheet').slice(0,100)){const target=targets.get(item.getAttribute('r:id')),sheet:SheetData={name:item.getAttribute('name')||'工作表',rows:[],columns:0,truncated:false};sheets.push(sheet);const doc=target&&await read(target);if(!doc)continue;
  for(const row of all(doc,'row')){const cells:SheetCell[]=[];for(const cell of children(row)){if(cell.localName!=='c')continue;const address=cell.getAttribute('r')||'',letters=address.match(/^[A-Z]+/i)?.[0]||'';let column=0;for(const c of letters.toUpperCase())column=column*26+c.charCodeAt(0)-64;column--;if(column<0)column=cells.length;if(column>=200){sheet.truncated=true;continue;}const raw=first(cell,'v')?.textContent||'',type=cell.getAttribute('t'),formula=first(cell,'f')?.textContent||undefined;const value=type==='s'?strings[Number(raw)]||'':type==='inlineStr'?all(cell,'t').map(t=>t.textContent).join(''):type==='b'?(raw==='1'?'TRUE':'FALSE'):format(raw,Number(cell.getAttribute('s')||0));if(value||formula)cells.push({column,value:value.slice(0,32768),formula:formula?.slice(0,32768)});}const prior=sheet.rows.length;add(sheet,Number(row.getAttribute('r'))||prior+1,cells);if(sheet.truncated&&sheet.rows.length===prior&&cells.length)break;}
 }return {sheets};
}
