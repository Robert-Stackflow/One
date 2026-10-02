import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {FileStamp} from '../shared/file-tools';
import type {DocumentPart,DocumentOptions} from './document-text';

/** Share the file's byte storage with PDF.js instead of copying a second complete PDF. */
export async function* extractPdf(file:FileStamp,options:DocumentOptions):AsyncGenerator<DocumentPart>{
 const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'),root=dirname(require.resolve('pdfjs-dist/package.json'));
 const buffer=await readFile(file.path),data=new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength);
 const task=pdf.getDocument({data,standardFontDataUrl:join(root,'standard_fonts').replace(/\\/g,'/')+'/',cMapUrl:join(root,'cmaps').replace(/\\/g,'/')+'/',cMapPacked:true,disableFontFace:true,useSystemFonts:false});
 try{
  const document=await task.promise;
  for(let page=1;page<=document.numPages;page++){
   options.progress?.(`提取 PDF 正文 · ${page}/${document.numPages} 页`);const p=await document.getPage(page);
   try{const content=await p.getTextContent();yield{text:content.items.map(item=>'str'in item?item.str+('hasEOL'in item&&item.hasEOL?'\n':' '):'').join(''),page,line:1};}finally{p.cleanup();}
  }
 }finally{await task.destroy();}
}
