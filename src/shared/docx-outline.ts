import JSZip from 'jszip';
import {DOMParser, XMLSerializer, type Element} from '@xmldom/xmldom';

export interface DocxHeading {label:string;depth:number;bookmark:string}
const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const elements=(node:Element,name:string)=>Array.from(node.getElementsByTagNameNS(word,name));
const value=(node:Element|undefined)=>node?.getAttributeNS(word,'val')??undefined;

/** Add private in-memory heading anchors so directory jumps need no text search. */
export async function prepareDocxOutline(bytes:ArrayBuffer):Promise<{bytes:ArrayBuffer;headings:DocxHeading[]}>{
 const archive=await JSZip.loadAsync(bytes);
 const parse=(text:string)=>new DOMParser({onError:(level,message)=>{throw new Error(`文档 XML 无法读取：${level}: ${message}`);}}).parseFromString(text,'application/xml');
 const part=archive.file('word/document.xml');
 if(!part)throw new Error('文档缺少正文');
 const document=parse(await part.async('string')),body=document.getElementsByTagNameNS(word,'body')[0];
 if(!body)throw new Error('文档缺少正文');
 const stylePart=archive.file('word/styles.xml'),styles=new Map<string,Element>();
 if(stylePart)for(const style of elements(parse(await stylePart.async('string')).documentElement!,'style'))styles.set(style.getAttributeNS(word,'styleId')||'',style);
 const level=(id:string,seen=new Set<string>()):number|undefined=>{
  if(seen.has(id))return;seen.add(id);const style=styles.get(id);if(!style)return;
  const direct=value(elements(style,'outlineLvl')[0]);if(direct!==undefined)return Number(direct);
  const name=value(elements(style,'name')[0])||id,match=/^(?:heading|标题)\s*([1-9])(?:\b|$)/i.exec(name);
  if(match)return Number(match[1])-1;
  const parent=value(elements(style,'basedOn')[0]);return parent?level(parent,seen):undefined;
 };
 const occupied=new Set(elements(body,'bookmarkStart').map(node=>node.getAttributeNS(word,'name')));
 let id=elements(body,'bookmarkStart').reduce((max,node)=>Math.max(max,Number(node.getAttributeNS(word,'id'))||0),0);
 const headings:DocxHeading[]=[];
 for(const paragraph of elements(body,'p')){
  const properties=Array.from(paragraph.childNodes).find(node=>node.nodeType===1&&node.localName==='pPr') as Element|undefined;
  const explicit=properties&&value(elements(properties,'outlineLvl')[0]);
  const depth=explicit!==undefined?Number(explicit):level(properties?value(elements(properties,'pStyle')[0])||'':'');
  const label=elements(paragraph,'t').map(node=>node.textContent||'').join('').trim();
  if(depth===undefined||!Number.isInteger(depth)||depth<0||depth>8||!label)continue;
  if(headings.length>=5000)throw new Error('文档目录超过预览上限');
  let bookmark=elements(paragraph,'bookmarkStart').map(node=>node.getAttributeNS(word,'name')).find(name=>name&&name!=='_GoBack');
  if(!bookmark){
   do{bookmark=`_OnePreviewHeading_${++id}`;}while(occupied.has(bookmark));occupied.add(bookmark);
   const start=document.createElementNS(word,'w:bookmarkStart'),end=document.createElementNS(word,'w:bookmarkEnd');
   start.setAttributeNS(word,'w:id',String(id));start.setAttributeNS(word,'w:name',bookmark);end.setAttributeNS(word,'w:id',String(id));
   paragraph.insertBefore(start,properties?properties.nextSibling:paragraph.firstChild);paragraph.appendChild(end);
  }
  headings.push({label,depth,bookmark});
 }
 if(!headings.length)return {bytes,headings};
 archive.file('word/document.xml',new XMLSerializer().serializeToString(document));
 return {bytes:await archive.generateAsync({type:'arraybuffer',compression:'DEFLATE',compressionOptions:{level:1}}),headings};
}
