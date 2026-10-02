// Isolate native module shutdown without starting global hooks or using user data.
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
 const root=path.resolve('work/exit-latency');await fs.mkdir(root,{recursive:true});
 const entry=path.join(root,'fixture.cjs');
 await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');
 const fs=require('node:fs');const record=value=>fs.appendFileSync(process.env.ONE_EXIT_LOG,JSON.stringify({at:Date.now(),...value})+'\\n');
 app.setPath('userData',process.env.ONE_DATA_DIR);
 if(process.env.ONE_EXIT_MODULE==='koffi')require('../../node_modules/koffi');
 if(process.env.ONE_EXIT_MODULE==='uiohook')require('../../node_modules/uiohook-napi');
 if(process.env.ONE_EXIT_MODULE==='worker-koffi'){
  const {Worker}=require('node:worker_threads');const worker=new Worker("require("+JSON.stringify(require.resolve('../../node_modules/koffi'))+");setInterval(()=>{},1000)",{eval:true});
  app.on('before-quit',()=>{void worker.terminate();});
 }
 process.on('exit',code=>record({event:'process-exit',code}));
 app.on('before-quit',()=>record({event:'before-quit'}));app.on('will-quit',()=>record({event:'will-quit'}));
 app.whenReady().then(()=>{new BrowserWindow({show:false}).loadURL('data:text/html,exit latency');setTimeout(()=>app.quit(),1000);});`);
 const results=[];
 for(const name of ['plain','koffi','uiohook','worker-koffi']){
  const profile=await fs.mkdtemp(path.join(root,name+'-')),log=path.join(root,name+'.jsonl');await fs.writeFile(log,'');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_EXIT_LOG:log,ONE_EXIT_MODULE:name};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[entry],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let exited=false,stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const done=new Promise(resolve=>child.once('exit',(code,signal)=>{exited=true;resolve({code,signal,at:Date.now()});}));
  try{
   const start=Date.now(),result=await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error(name+' exit timeout\n'+stderr)),20000).unref())]);
   const records=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse),before=records.find(r=>r.event==='before-quit'),processExit=records.find(r=>r.event==='process-exit');
   assert.equal(result.code,0);results.push({name,totalMs:result.at-start,cleanupMs:processExit.at-before.at,nativeMs:result.at-processExit.at});
   console.log(JSON.stringify(results.at(-1)));
  }finally{if(!exited)child.kill('SIGKILL');}
 }
 await fs.writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
