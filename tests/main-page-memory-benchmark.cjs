const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const {buildSync}=require('esbuild');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const output=path.resolve('work/app-memory'),profile=await fs.mkdtemp(path.join(output,'pages-')),files=await fs.mkdtemp(path.join(output,'empty-root-'));
 buildSync({entryPoints:['src/shared/settings.ts'],outfile:path.join(output,'page-settings.cjs'),bundle:true,platform:'node'});
 const {mergeSettings,defaultSettings}=require(path.join(output,'page-settings.cjs'));
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(mergeSettings(defaultSettings(),{search:{roots:[files],maxEntries:1000},diskMonitor:{enabled:false,notify:false}})));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.ONE_PACKAGED_EXE||path.resolve('work/installer-output',require('../package.json').version,'win-unpacked','One.exe');
 const app=await electron.launch({executablePath,args:[],env}),results=[];
 try{
  const page=await app.firstWindow();await page.waitForSelector('#page-home:not([hidden])');
  const pid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).webContents.getOSProcessId());
  const measure=async(name,latencyMs=0)=>{const data=await snapshot(app),renderer=data.processes.find(p=>p.pid===pid),dom=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,byPage:Object.fromEntries([...document.querySelectorAll('.page')].map(p=>[p.id,p.querySelectorAll('*').length]))}));results.push({name,latencyMs,residentMB:Math.round(data.resident/1048576),privateResidentMB:Math.round(data.privateResident/1048576),rendererMB:Math.round((renderer?.resident||0)/1048576),rendererPrivateMB:Math.round((renderer?.privateResident||0)/1048576),processes:data.processes.length,...dom});};
  await measure('home');
  for(const id of ['tools','text','search','disk','hardware','settings']){
   const started=performance.now();await page.locator(`[data-page=${id}]`).click();await page.locator(`#page-${id}:not([hidden])`).waitFor();await measure(id,Math.round(performance.now()-started));
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).hide());
  await new Promise(resolve=>setTimeout(resolve,3000));await measure('hidden-after-pages');
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
  await new Promise(resolve=>setTimeout(resolve,1000));await measure('hidden-after-gc');
  console.log(JSON.stringify(results));
  await fs.writeFile(path.join(output,'page-memory-current.json'),JSON.stringify(results,null,2));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
