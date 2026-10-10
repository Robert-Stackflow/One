import JSZip from 'jszip';
import {DOMParser,type Element} from '@xmldom/xmldom';

export interface PptxHeading {label:string;hidden:boolean;notes:string}
const presentation='http://schemas.openxmlformats.org/presentationml/2006/main';
const drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
const relations='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelations='http://schemas.openxmlformats.org/package/2006/relationships';
const elements=(node:Element,namespace:string,name:string)=>Array.from(node.getElementsByTagNameNS(namespace,name));

/** Read titles in presentation order off the UI thread; never rewrite the file. */
export async function preparePptxOutline(bytes:ArrayBuffer):Promise<{bytes:ArrayBuffer;headings:PptxHeading[]}>{
 const archive=await JSZip.loadAsync(bytes);
 const parse=(text:string)=>new DOMParser({onError:(level,message)=>{throw new Error(`演示文稿 XML 无法读取：${level}: ${message}`);}}).parseFromString(text,'application/xml').documentElement!;
 const part=async(path:string)=>{const file=archive.file(path);if(!file)throw new Error('演示文稿缺少页面');return parse(await file.async('string'));};
 const root=await part('ppt/presentation.xml'),rels=await part('ppt/_rels/presentation.xml.rels');
 const paths=new Map(elements(rels,packageRelations,'Relationship').filter(node=>node.getAttribute('TargetMode')!=='External').map(node=>[node.getAttribute('Id'),node.getAttribute('Target')||'']));
 const slides=elements(root,presentation,'sldId');if(!slides.length)throw new Error('演示文稿没有页面');if(slides.length>5000)throw new Error('演示文稿页数超过预览上限');
 const headings:PptxHeading[]=[];
 for(const slide of slides){
  const target=paths.get(slide.getAttributeNS(relations,'id'))||'';
  const segments=(target.startsWith('/')?target.slice(1):'ppt/'+target).split('/'),normalized:string[]=[];
  for(const segment of segments){if(segment==='..')normalized.pop();else if(segment&&segment!=='.')normalized.push(segment);}
  const path=normalized.join('/');if(!/^ppt\/slides\/[^/]+\.xml$/.test(path))throw new Error('演示文稿页面引用无效');
  const page=await part(path),shapes=elements(page,presentation,'sp');
  const title=shapes.find(shape=>elements(shape,presentation,'ph').some(node=>['title','ctrTitle'].includes(node.getAttribute('type')||'')));
  const text=(node:Element)=>elements(node,drawing,'t').map(item=>item.textContent||'').join(' ').replace(/\s+/g,' ').trim();
  const label=(title&&text(title))||shapes.map(text).find(Boolean)||`第 ${headings.length+1} 张`;
  let notes='';
  const relPart=archive.file(`ppt/slides/_rels/${path.split('/').pop()}.rels`);
  if(relPart){
   const noteRelation=elements(parse(await relPart.async('string')),packageRelations,'Relationship').find(node=>node.getAttribute('Type')===relations+'/notesSlide'&&node.getAttribute('TargetMode')!=='External');
   if(noteRelation){
    const noteTarget=noteRelation.getAttribute('Target')||'',parts=(noteTarget.startsWith('/')?noteTarget.slice(1):'ppt/slides/'+noteTarget).split('/'),resolved:string[]=[];
    for(const segment of parts){if(segment==='..')resolved.pop();else if(segment&&segment!=='.')resolved.push(segment);}
    const notePath=resolved.join('/');if(!/^ppt\/notesSlides\/[^/]+\.xml$/.test(notePath))throw new Error('演示文稿备注引用无效');
    const note=await part(notePath);
    const content=(node:Element):string=>Array.from(node.childNodes).map(child=>child.nodeType!==1?'':child.namespaceURI===drawing&&child.localName==='t'?child.textContent||'':child.namespaceURI===drawing&&child.localName==='br'?'\n':child.namespaceURI===drawing&&child.localName==='tab'?'\t':content(child as Element)).join('');
    notes=elements(note,presentation,'sp').filter(shape=>!elements(shape,presentation,'ph').some(node=>['sldImg','sldNum','dt','hdr','ftr'].includes(node.getAttribute('type')||''))).flatMap(shape=>elements(shape,drawing,'p').map(content)).join('\n').trim();
   }
  }
  headings.push({label:label.slice(0,240),hidden:page.getAttribute('show')==='0'||page.getAttribute('show')==='false',notes});
 }
 return {bytes,headings};
}
