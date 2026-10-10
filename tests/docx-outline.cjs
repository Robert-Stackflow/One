const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),JSZip=require('jszip');
const {build}=require('esbuild');
(async()=>{
 const root=path.resolve('work/current/office-preview/docx-outline'),files=path.join(root,'fixtures');await require('./docx-preview-fixtures.cjs')(files);
 await build({entryPoints:['src/shared/docx-outline.ts'],outfile:path.join(root,'outline.cjs'),bundle:true,platform:'node',target:'node22',logLevel:'silent'});
 const {prepareDocxOutline}=require(path.join(root,'outline.cjs')),buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const original=await fs.readFile(path.join(files,'daily.docx')),prepared=await prepareDocxOutline(buffer(original));
 assert.deepEqual(prepared.headings.map(h=>[h.label,h.depth]),[['章节_1_中文',0],['章节_60_中文',0],['章节_120_中文',0]]);assert.equal(new Set(prepared.headings.map(h=>h.bookmark)).size,3);
 const zip=await JSZip.loadAsync(prepared.bytes),xml=await zip.file('word/document.xml').async('string');for(const h of prepared.headings)assert.ok(xml.includes(h.bookmark));
 await assert.rejects(prepareDocxOutline(buffer(await fs.readFile(path.join(files,'malformed.docx')))),/XML/);
 const changed=await JSZip.loadAsync(original);let text=await changed.file('word/document.xml').async('string');
 text=text.replace('<w:body>','<w:body><w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:bookmarkStart w:id="50" w:name="existing_heading"/><w:r><w:t>Direct heading</w:t></w:r><w:bookmarkEnd w:id="50"/></w:p><w:p><w:pPr><w:outlineLvl w:val="9"/><w:pStyle w:val="MyHeading"/></w:pPr><w:r><w:t>Not a heading</w:t></w:r></w:p>');
 // Namespace prefixes may vary across producers; IDs/names are preserved.
 changed.file('word/document.xml',text.replaceAll('w:','q:').replace('xmlns:w=','xmlns:q='));
 const inherited=await prepareDocxOutline(await changed.generateAsync({type:'arraybuffer'}));assert.equal(inherited.headings.length,4);assert.deepEqual(inherited.headings[0],{label:'Direct heading',depth:2,bookmark:'existing_heading'});assert.ok(!inherited.headings.some(h=>h.label==='Not a heading'));
 const empty=await JSZip.loadAsync(original);empty.file('word/document.xml',text.replaceAll('<w:pStyle w:val="MyHeading"/>','').replaceAll('<w:outlineLvl w:val="2"/>',''));const noHeading=await empty.generateAsync({type:'arraybuffer'}),same=await prepareDocxOutline(noHeading);assert.equal(same.headings.length,0);assert.equal(same.bytes,noHeading);
 console.log('DOCX outline: inherited/direct/excluded levels, namespace variation, existing/private bookmarks, malformed XML and no-heading pass.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
