const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createPDF}=require('./pdf-scroll-fixtures.cjs'),{snapshot,readProcessCounters}=require('./app-memory-benchmark.cjs');
const MiB=1024**2;
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/pdf-scroll'),files=path.resolve(process.env.ONE_PDF_FIXTURE_DIR||path.join(out,'files'));await fs.mkdir(out,{recursive:true});await fs.mkdir(files,{recursive:true});
 const imageFile=path.join(files,'80-images.pdf'),longFile=path.join(files,'2050-pages.pdf');if(!await fs.stat(imageFile).catch(()=>null))await createPDF(imageFile,80,512);if(!await fs.stat(longFile).catch(()=>null))await createPDF(longFile,2050);
 const profile=await fs.mkdtemp(path.join(out,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');await main.evaluate(()=>window.one.patchSettings({preview:{held:true,files:false}}));
  const opening=app.waitForEvent('window',{predicate:page=>page.url().includes('view=preview')});await main.evaluate(file=>window.one.preview(file),imageFile);const preview=await opening;await expect(preview.locator('.pdf-sheet')).toHaveCount(80);await expect(preview.locator('.pdf-sheet[data-page="1"]')).toHaveClass(/is-rendered/,{timeout:20000});await preview.waitForTimeout(1500);
  const tree=await snapshot(app),previewPID=tree.windows.find(window=>window.view==='preview').pid;
  const read=()=>{const value=readProcessCounters(tree.processes);return{at:value.at,privateMiB:value.private/MiB,residentMiB:value.resident/MiB,previewPrivateMiB:value.processes.find(process=>process.pid===previewPID)?.private/MiB,processPrivateMiB:value.processes.map(process=>({pid:process.pid,privateMiB:process.private/MiB}))};};
  const before=read(),samples=[before],started=Date.now();
  await preview.evaluate(()=>{window.pdfGaps=[];let last=performance.now();window.pdfHeartbeat=setInterval(()=>{const now=performance.now();window.pdfGaps.push(now-last);last=now;},20);const seen=new WeakSet();window.pdfCanvasCount=0;const record=canvas=>{if(!seen.has(canvas)){seen.add(canvas);window.pdfCanvasCount++;}};document.querySelectorAll('.pdf-sheet canvas').forEach(record);window.pdfCanvasObserver=new MutationObserver(()=>document.querySelectorAll('.pdf-sheet canvas').forEach(record));window.pdfCanvasObserver.observe(document.querySelector('.pdf-pages'),{subtree:true,childList:true});});
  for(let page=1;page<=80;page++){
   await preview.locator('#pdf-page').evaluate((input,n)=>{input.value=String(n);input.dispatchEvent(new Event('change',{bubbles:true}));},page);
   await expect(preview.locator(`.pdf-sheet[data-page="${page}"]`)).toHaveClass(/is-rendered/,{timeout:15000});await expect(preview.locator(`.pdf-sheet[data-page="${page}"] .textLayer`)).toContainText(`PDF_MARKER_${page}_END`);if(page%10===0)samples.push(read());
  }
  await preview.waitForTimeout(1000);const after=read(),rendered=await preview.locator('.pdf-sheet canvas').count();assert.ok(rendered<=8,`Too many visible-page canvases: ${rendered}`);
  await preview.locator('#pdf-page').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('change',{bubbles:true}));});await expect(preview.locator('.pdf-sheet[data-page="1"]')).toHaveClass(/is-rendered/);await expect(preview.locator('.pdf-sheet[data-page="1"] .textLayer')).toContainText('PDF_MARKER_1_END');
  const counters=await preview.evaluate(()=>{clearInterval(window.pdfHeartbeat);window.pdfCanvasObserver.disconnect();return{gaps:window.pdfGaps,canvasCount:window.pdfCanvasCount};}),gaps=counters.gaps;gaps.sort((a,b)=>a-b);const scrollResult={before,after,samples,rendered,canvasCount:counters.canvasCount,elapsedMs:Date.now()-started,p95:gaps[Math.floor(gaps.length*.95)],maxGap:gaps.at(-1)};
  await preview.evaluate(file=>window.one.selectPreview(file),longFile);await expect(preview.locator('.pdf-sheet')).toHaveCount(2050,{timeout:20000});await expect(preview.locator('.pdf-sheet[data-page="1"]')).toHaveClass(/is-rendered/);await preview.locator('#pdf-search').fill('PDF_MARKER_2050_END');const searchStart=Date.now();await preview.locator('#pdf-find').click();
  await expect.poll(()=>preview.locator('#pdf-found').textContent(),{timeout:30000}).not.toMatch(/查找中|查找 \d/);const status=await preview.locator('#pdf-found').textContent(),search={status,elapsedMs:Date.now()-searchStart,page:await preview.locator('#pdf-page').inputValue()};
  if(process.env.ONE_EXPECT_PDF_SEARCH_LIMIT==='1'){assert.equal(status,'未找到');assert.equal(search.page,'1');}
  else{assert.match(status,/1\/1/);assert.equal(search.page,'2050');await expect(preview.locator('.pdf-sheet[data-page="2050"] .textLayer')).toContainText('PDF_MARKER_2050_END');}
  assert.deepEqual(errors,[]);const result={result:process.env.ONE_EXPECT_PDF_SEARCH_LIMIT==='1'?'EXPECTED_BASELINE_LIMIT':'PASS',imageBytes:(await fs.stat(imageFile)).size,scroll:scrollResult,search,errors};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
