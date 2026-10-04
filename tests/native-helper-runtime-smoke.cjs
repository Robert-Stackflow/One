const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const root=path.resolve(process.env.ONE_TEST_APP_ROOT||'.');
 const profile=await fs.mkdtemp(path.resolve('work/native-helper-runtime-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#overview-index');
  await page.evaluate(()=>window.one.patchSettings({edgeScroll:true,search:{explorerTyping:true},diskMonitor:{enabled:true,notify:false},utilities:{topmost:{enabled:true,shortcut:''}}}));
  const names=['One.Index.exe','One.Search.exe','One.Levels.exe','One.Monitor.exe','One.Windows.exe'];
  await expect.poll(async()=>{const state=await snapshot(app);return names.filter(name=>state.processes.some(p=>p.name===name)).length;},{timeout:15000}).toBe(names.length);
  const state=await snapshot(app),helpers=state.processes.filter(p=>names.includes(p.name)),consoles=state.processes.filter(p=>p.name==='conhost.exe'),conhosts=consoles.length;
  assert.equal(conhosts,Number(process.env.ONE_EXPECT_CONHOSTS||0),'resident helper console-host count');
  assert.equal(helpers.length,names.length);
  assert.ok((await page.evaluate(()=>window.one.searchState())).count>=0);
  console.log(JSON.stringify({result:'PASS',helpers:helpers.map(p=>p.name),conhosts,consolePrivateMiB:Math.round(consoles.reduce((n,p)=>n+p.private,0)/1024**2*10)/10,consoleResidentMiB:Math.round(consoles.reduce((n,p)=>n+p.resident,0)/1024**2*10)/10,privateMiB:Math.round(state.private/1024**2),residentMiB:Math.round(state.resident/1024**2)}));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
