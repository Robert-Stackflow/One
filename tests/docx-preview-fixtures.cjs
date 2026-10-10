const fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip');
module.exports=async function fixtures(folder){
 await fs.mkdir(folder,{recursive:true});const z=new JSZip(),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships',pr='http://schemas.openxmlformats.org/package/2006/relationships';
 z.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
 z.file('_rels/.rels',`<Relationships xmlns="${pr}"><Relationship Id="document" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
 z.file('word/_rels/document.xml.rels',`<Relationships xmlns="${pr}"><Relationship Id="styles" Type="${r}/styles" Target="styles.xml"/></Relationships>`);
 z.file('word/styles.xml',`<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="BaseHeading"><w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="MyHeading"><w:basedOn w:val="BaseHeading"/></w:style></w:styles>`);
 let body='';for(let n=1;n<=120;n++){const heading=[1,60,120].includes(n);body+=`<w:p>${heading?'<w:pPr><w:pStyle w:val="MyHeading"/></w:pPr>':''}<w:r><w:t>${heading?'章节_'+n+'_中文':'PARAGRAPH_'+n+' This is a sample document paragraph.'}</w:t></w:r></w:p>`;}
 const document=`<w:document xmlns:w="${w}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
 z.file('word/document.xml',document);await fs.writeFile(path.join(folder,'daily.docx'),await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 z.file('word/document.xml','<w:document>broken');await fs.writeFile(path.join(folder,'malformed.docx'),await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 await fs.writeFile(path.join(folder,'plain.txt'),'PLAIN_DOCX_EXIT');
};
