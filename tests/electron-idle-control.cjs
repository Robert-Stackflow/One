const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const output=path.resolve('work/app-memory');await fs.mkdir(output,{recursive:true});
 const root=await fs.mkdtemp(path.join(output,'electron-control-'));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'one-electron-idle-control',version:'1.0.0',main:'main.cjs'}));
 await fs.writeFile(path.join(root,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const window=new BrowserWindow({show:false,x:-10000,y:-10000,width:1100,height:800});void window.loadURL('data:text/html,<body>Idle control</body>').then(()=>{window.showInactive();window.hide();});});app.on('window-all-closed',()=>app.quit());`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});
 try{
  await app.firstWindow();await new Promise(resolve=>setTimeout(resolve,2500));
  const start=await snapshot(app);await new Promise(resolve=>setTimeout(resolve,15000));const end=await snapshot(app);
  const deltaMs=end.at-start.at,byRole=end.processes.map(process=>{const before=start.processes.find(item=>item.pid===process.pid);return{pid:process.pid,role:process.type||process.name,cpuSeconds:before?process.cpuSeconds-before.cpuSeconds:0,privateResidentMiB:process.privateResident/1048576};});
  assert.ok(deltaMs>=14000);const result={date:new Date().toISOString(),deltaMs,cpuPercentOneCore:(end.cpuSeconds-start.cpuSeconds)/deltaMs*100000,start,end,byRole};
  await fs.writeFile(path.join(output,'electron-idle-control.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({deltaMs,cpuPercentOneCore:result.cpuPercentOneCore,privateResidentMiB:end.privateResident/1048576,byRole}));
 }finally{await app.close();const owned=await fs.realpath(root),parent=await fs.realpath(output);assert.equal(path.dirname(owned).toLowerCase(),parent.toLowerCase());await fs.rm(owned,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
