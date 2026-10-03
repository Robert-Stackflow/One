const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {build}=require('esbuild');
const JSZip=require('jszip');
const koffi=require('koffi');

const Memory=koffi.struct('OneWorkbookMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'});
const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll');
const open=kernel.func('void * __stdcall OpenProcess(uint32,int,uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)');
const getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneWorkbookMemory *, uint32)');
async function childRead(module,file){
 const code="const {readWorkbook}=require(process.argv[1]);readWorkbook(process.argv[2]).then(value=>console.log(JSON.stringify({sheets:value.sheets.map(sheet=>({name:sheet.name,rows:sheet.rows.length,first:sheet.rows[0]?.cells[0]?.value}))}))).catch(error=>{console.error(error);process.exitCode=1;});";
 const started=performance.now(),child=spawn(process.execPath,['-e',code,module,file],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const handle=open(0x1000|0x0400,0,child.pid);let peak=0,out='',err='';
 const sample=()=>{if(!handle)return;const value={cb:koffi.sizeof(Memory)};if(getMemory(handle,value,value.cb))peak=Math.max(peak,value.PrivateUsage);};
 sample();const timer=setInterval(sample,5);child.stdout.on('data',part=>out+=part);child.stderr.on('data',part=>err+=part);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 clearInterval(timer);sample();if(handle)close(handle);
 assert.equal(exit,0,err);return {...JSON.parse(out),elapsedMs:performance.now()-started,peakPrivate:peak};
}
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/workbook-stream-native');await fs.mkdir(out,{recursive:true});
 const temporary=await fs.mkdtemp(path.join(out,'case-'));
 try{
  const module=path.join(temporary,'workbook.cjs'),xlsx=path.join(temporary,'large.xlsx'),ods=path.join(temporary,'small.ods');
  await build({entryPoints:['src/main/workbook.ts'],outfile:module,bundle:true,platform:'node',target:'node22'});
  const book=new JSZip();
  book.file('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Large" r:id="r1"/></sheets></workbook>');
  book.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
  book.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>TAIL_MARKER</t></is></c></row></sheetData></worksheet>');
  for(let i=0;i<2;i++)book.file('xl/media/unused-'+i+'.bin',randomBytes(18*1024*1024),{compression:'STORE'});
  await fs.writeFile(xlsx,await book.generateAsync({type:'nodebuffer',compression:'STORE'}));
  assert.ok((await fs.stat(xlsx)).size<50*1024*1024);
  const large=await childRead(module,xlsx);
  assert.deepEqual(large.sheets,[{name:'Large',rows:1,first:'TAIL_MARKER'}]);
  const baseline=process.env.ONE_WORKBOOK_BASELINE?await childRead(path.resolve(process.env.ONE_WORKBOOK_BASELINE),xlsx):undefined;
  if(baseline)assert.deepEqual(baseline.sheets,large.sheets);
  const service=path.join(temporary,'preview-service.cjs');
  await build({entryPoints:['src/main/preview-service.ts'],outfile:service,bundle:true,platform:'node',target:'node22'});
  await build({entryPoints:['src/main/preview-worker.ts'],outfile:path.join(temporary,'preview-worker.cjs'),bundle:true,platform:'node',target:'node22'});
  const previewStarted=performance.now(),preview=await require(service).preparePreview(xlsx,()=> 'one-file://fixture',async()=>{throw new Error('No navigation fixture');}),previewMs=performance.now()-previewStarted;
  assert.equal(preview.type,'workbook');
  assert.equal(preview.workbook.sheets[0].rows[0].cells[0].value,'TAIL_MARKER');
  const odsZip=new JSZip();odsZip.file('content.xml','<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><table:table table:name="小表"><table:table-row><table:table-cell><text:p>中文</text:p></table:table-cell></table:table-row></table:table></office:document-content>');
  await fs.writeFile(ods,await odsZip.generateAsync({type:'nodebuffer'}));
  const small=await childRead(module,ods);
  assert.deepEqual(small.sheets,[{name:'小表',rows:1,first:'中文'}]);
  const report={result:'PASS',largeBytes:(await fs.stat(xlsx)).size,largeMs:large.elapsedMs,largePeakPrivateMiB:large.peakPrivate/1024**2,baselineMs:baseline?.elapsedMs,baselinePeakPrivateMiB:baseline&&baseline.peakPrivate/1024**2,largePreview:true,largePreviewMs:previewMs,ods:true};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{
  const target=await fs.realpath(temporary),parent=await fs.realpath(out);
  assert.equal(path.dirname(target).toLowerCase(),parent.toLowerCase());
  await fs.rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
