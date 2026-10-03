// Freeze the baseline text-document.ts before editing, then run in the same Electron build.
const {_electron:electron}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{build}=require('esbuild');
const cases=[{name:'350k-lines',piece:' 甲乙丙丁  \n',repeat:350000},{name:'long-line',piece:'甲🙂',repeat:2000000},{name:'dense-mixed-endings',piece:'\r\n\r\n🙂\n',repeat:250000}];
async function measure(bundle,fixture,out){
 const profile=await fs.mkdtemp(path.join(out,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env,bypassCSP:true});try{
  const page=await app.firstWindow();await page.waitForSelector('[data-page=text]');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false)));await page.addScriptTag({content:bundle});
  const result=await page.evaluate(async fixture=>{
   const text=fixture.piece.repeat(fixture.repeat),gaps=[];let last=performance.now(),yields=0;const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},16),schedule=window.setTimeout;
   window.setTimeout=(callback,delay,...args)=>{if(delay===0)yields++;return schedule(callback,delay,...args);};
   let parsed,elapsedMs;try{const at=performance.now();parsed=await OneImport.parseText(text);elapsedMs=performance.now()-at;}finally{window.setTimeout=schedule;clearInterval(timer);gaps.push(performance.now()-last);}
   const output=await OneImport.serializeTextAsync(parsed.doc,parsed.endings);return {elapsedMs,yields,maxGapMs:Math.max(...gaps),inputCharacters:text.length,lines:parsed.doc.lines,exact:output===text};
  },fixture);assert.equal(result.exact,true,fixture.name);return result;
 }finally{await app.close();}
}
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/text-import-performance');await fs.mkdir(out,{recursive:true});const baseline=path.resolve(process.env.ONE_TEXT_IMPORT_BASELINE||path.join(out,'before.ts'));
 const compile=async entry=>(await build({entryPoints:[entry],bundle:true,platform:'browser',format:'iife',globalName:'OneImport',write:false})).outputFiles[0].text;
 const bundles={before:await compile(baseline),after:await compile('src/renderer/text-document.ts')},report={date:new Date().toISOString(),rounds:[]};
 for(let n=0;n<2;n++){const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=[];for(const fixture of cases)round[side].push({name:fixture.name,...await measure(bundles[side],fixture,out)});console.log(JSON.stringify({round:n+1,side,results:round[side]}));}report.rounds.push(round);}
 const average=(side,i,key)=>report.rounds.reduce((sum,r)=>sum+r[side][i][key],0)/report.rounds.length;report.cases=cases.map((fixture,i)=>({name:fixture.name,beforeMs:average('before',i,'elapsedMs'),afterMs:average('after',i,'elapsedMs'),beforeYields:average('before',i,'yields'),afterYields:average('after',i,'yields'),afterMaxGapMs:Math.max(...report.rounds.map(r=>r.after[i].maxGapMs))}));
 report.result='MEASURED';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));for(const row of report.cases){assert.ok(row.afterMs<=row.beforeMs*1.1+10,'Import response regression: '+row.name);assert.ok(row.afterMaxGapMs<80,'Import blocked the interface: '+row.name);}assert.ok(report.cases[0].afterMs<report.cases[0].beforeMs*.8,'Expected fewer timer delays for ordinary long text');report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,cases:report.cases}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
