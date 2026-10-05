const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {build}=require('esbuild');
const JSZip=require('jszip');
const koffi=require('koffi');

const Memory=koffi.struct('OneDenseWorkbookMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'});
const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll');
const open=kernel.func('void * __stdcall OpenProcess(uint32,int,uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)');
const getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneDenseWorkbookMemory *, uint32)');

async function measure(module,file){
 const code=`const {readWorkbook}=require(process.argv[1]),{createHash}=require('node:crypto');readWorkbook(process.argv[2]).then(book=>{const hash=createHash('sha256');for(const sheet of book.sheets)for(const row of sheet.rows)for(const cell of row.cells)hash.update(JSON.stringify([row.number,cell.column,cell.value,cell.formula]));console.log(JSON.stringify({sheets:book.sheets.map(sheet=>({name:sheet.name,rows:sheet.rows.length,columns:sheet.columns,truncated:sheet.truncated,first:sheet.rows[0]?.cells[0]?.value,last:sheet.rows.at(-1)?.cells.at(-1)?.value})),digest:hash.digest('hex')}));}).catch(error=>{console.error(error);process.exitCode=1;});`;
 const started=performance.now(),child=spawn(process.execPath,['-e',code,module,file],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const handle=open(0x1000|0x0400,0,child.pid);let peak=0,stdout='',stderr='';
 const sample=()=>{if(!handle)return;const info={cb:koffi.sizeof(Memory)};if(getMemory(handle,info,info.cb))peak=Math.max(peak,info.PrivateUsage);};
 sample();const timer=setInterval(sample,5);child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearInterval(timer);sample();if(handle)close(handle);
 assert.equal(exit,0,stderr);assert.ok(peak>0,'Private-memory sampling failed');return {...JSON.parse(stdout),elapsedMs:performance.now()-started,peakPrivateMiB:peak/1048576};
}

async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/workbook-dense');await fs.mkdir(out,{recursive:true});
 const file=path.join(out,'dense.xlsx'),ods=path.join(out,'dense.ods'),module=path.join(out,'after.cjs');
 if(!await fs.stat(file).catch(()=>false)){
  const archive=new JSZip();
  archive.file('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dense" r:id="r1"/></sheets></workbook>');
  archive.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
  archive.file('xl/sharedStrings.xml','<sst>'+Array.from({length:15000},(_,i)=>`<si><r><t>行 ${i} &amp; shared </t></r><r><t>中文内容 ${i}</t></r></si>`).join('')+'</sst>');
  archive.file('xl/styles.xml','<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>');
  const rows=Array.from({length:15000},(_,i)=>`<row r="${i+1}"><c r="A${i+1}" t="s"><v>${i}</v></c><c r="B${i+1}"><f>A${i+1}*2</f><v>${i*2}</v></c><c r="C${i+1}" s="1"><v>46023</v></c><c r="D${i+1}" t="b"><v>${i%2}</v></c><c r="E${i+1}" t="inlineStr"><is><t>第 ${i} 行</t></is></c></row>`).join('');
  archive.file('xl/worksheets/sheet1.xml','<worksheet><sheetData>'+rows+'</sheetData></worksheet>');
  await fs.writeFile(file,await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:1}}));
 }
 if(!await fs.stat(ods).catch(()=>false)){
  const archive=new JSZip();
  const rows=Array.from({length:15000},(_,i)=>`<table:table-row><table:table-cell><text:p>行 ${i} &amp; 正文</text:p></table:table-cell><table:table-cell table:formula="of:=A${i+1}*2" office:value="${i*2}"/><table:table-cell office:date-value="2026-10-05"/><table:table-cell><text:p>上 ${i}</text:p><text:p>下 ${i}</text:p></table:table-cell><table:covered-table-cell><text:p>覆盖 ${i}</text:p></table:covered-table-cell></table:table-row>`).join('');
  archive.file('content.xml','<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><table:table table:name="Dense ODS">'+rows+'</table:table><table:table table:name="Repeats"><table:table-row table:number-rows-repeated="3"><table:table-cell table:number-columns-repeated="2"><text:p>重复</text:p></table:table-cell></table:table-row></table:table></office:document-content>');
  await fs.writeFile(ods,await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:1}}));
 }
 await build({entryPoints:['src/main/workbook.ts'],outfile:module,bundle:true,platform:'node',target:'node22'});
 const current=await measure(module,file),baseline=process.env.ONE_WORKBOOK_BASELINE?await measure(path.resolve(process.env.ONE_WORKBOOK_BASELINE),file):undefined;
 if(baseline)assert.deepEqual({sheets:current.sheets,digest:current.digest},{sheets:baseline.sheets,digest:baseline.digest});
 const odsCurrent=await measure(module,ods),odsBaseline=process.env.ONE_ODS_BASELINE?await measure(path.resolve(process.env.ONE_ODS_BASELINE),ods):undefined;
 if(odsBaseline)assert.deepEqual({sheets:odsCurrent.sheets,digest:odsCurrent.digest},{sheets:odsBaseline.sheets,digest:odsBaseline.digest});
 const report={result:'PASS',bytes:(await fs.stat(file)).size,worksheetRows:15000,cells:75000,current,baseline,ods:{bytes:(await fs.stat(ods)).size,current:odsCurrent,baseline:odsBaseline}};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
