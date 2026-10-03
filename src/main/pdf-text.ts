import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {FileStamp} from '../shared/file-tools';
import type {DocumentPart,DocumentOptions} from './document-text';

/** Let PDF.js read file ranges as each page is extracted. */
export async function* extractPdf(file:FileStamp,options:DocumentOptions):AsyncGenerator<DocumentPart>{
 const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'),root=dirname(require.resolve('pdfjs-dist/package.json'));
 const task=pdf.getDocument({url:pathToFileURL(file.path).href,disableStream:true,disableAutoFetch:true,standardFontDataUrl:join(root,'standard_fonts').replace(/\\/g,'/')+'/',cMapUrl:join(root,'cmaps').replace(/\\/g,'/')+'/',cMapPacked:true,disableFontFace:true,useSystemFonts:false});
 try{
  const document=await task.promise;
  for(let page=1;page<=document.numPages;page++){
   options.progress?.(`提取 PDF 正文 · ${page}/${document.numPages} 页`);const p=await document.getPage(page);
   try{const content=await p.getTextContent();yield{text:content.items.map(item=>'str'in item?item.str+('hasEOL'in item&&item.hasEOL?'\n':' '):'').join(''),page,line:1};}finally{p.cleanup();}
  }
 }finally{await task.destroy();}
}
