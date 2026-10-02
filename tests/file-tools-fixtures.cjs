const fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip'),iconv=require('iconv-lite');
async function fixtures(base){const files=await fs.mkdtemp(path.join(base,'files-'));const docs=path.join(files,'docs'),dupes=path.join(files,'duplicates'),rename=path.join(files,'rename'),left=path.join(files,'left'),right=path.join(files,'right');for(const p of [docs,dupes,rename,left,right])await fs.mkdir(p,{recursive:true});
 await fs.writeFile(path.join(dupes,'a.txt'),'相同的内容');await fs.writeFile(path.join(dupes,'b.txt'),'相同的内容');await fs.writeFile(path.join(dupes,'c.txt'),'不同的内容');await fs.writeFile(path.join(dupes,'empty-a.bin'),'');await fs.writeFile(path.join(dupes,'empty-b.bin'),'');await fs.link(path.join(dupes,'a.txt'),path.join(dupes,'hardlink.txt'));
 const zip=async(name,entries)=>{const z=new JSZip();for(const [key,value]of Object.entries(entries))z.file(key,value);await fs.writeFile(path.join(docs,name),await z.generateAsync({type:'nodebuffer'}));};
 await fs.writeFile(path.join(docs,'utf8.txt'),'第一行\n重复文件功能上线了\n全文搜索：银河探险');await fs.writeFile(path.join(docs,'gbk.txt'),iconv.encode('GBK 中文编码 银河探险','gbk'));await fs.writeFile(path.join(docs,'unicode.txt'),Buffer.concat([Buffer.from([255,254]),iconv.encode('UTF16 银河探险','utf16le')]));
 await zip('word.docx',{'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>银河探险 文档正文</w:t></w:r></w:p></w:body></w:document>'});
 await zip('slides.pptx',{'ppt/slides/slide1.xml':'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>银河探险 演示文稿</a:t></a:r></a:p></p:sld>'});
 await zip('book.xlsx',{'xl/sharedStrings.xml':'<sst><si><t>银河探险 表格</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>42</v></c></row></sheetData></worksheet>'});
 await zip('book.epub',{'OEBPS/chapter.xhtml':'<html><body><h1>银河探险</h1><p>电子书正文</p></body></html>'});
 const stream='BT /F1 24 Tf 70 700 Td (Galaxy exploration) Tj ET\n',objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>
stream
${stream}endstream`];let pdf='%PDF-1.4\n';const offsets=[];for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj
${obj}
endobj
`;}const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer
<< /Size 6 /Root 1 0 R >>
startxref
${xref}
%%EOF`;await fs.writeFile(path.join(docs,'paper.pdf'),pdf);
 await fs.writeFile(path.join(rename,'old-01.txt'),'first');await fs.writeFile(path.join(rename,'old-02.txt'),'second');await fs.mkdir(path.join(rename,'old-dir'));await fs.writeFile(path.join(rename,'old-dir','old-03.txt'),'third');
 await fs.writeFile(path.join(left,'same.txt'),'same');await fs.writeFile(path.join(right,'same.txt'),'same');await fs.writeFile(path.join(left,'change.txt'),'alpha\nbefore\nomega\n');await fs.writeFile(path.join(right,'change.txt'),'alpha\nafter\nomega\n');await fs.writeFile(path.join(left,'removed.txt'),'old');await fs.writeFile(path.join(right,'added.txt'),'new');return {files,docs,dupes,rename,left,right};}
module.exports={fixtures};
