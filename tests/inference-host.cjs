const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),assert=require('node:assert/strict'),path=require('node:path');
const helper=path.resolve(process.env.ONE_INFERENCE_MONITOR||'dist/native/One.Monitor.exe');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function start(code,args=[],budget=512){
  const child=spawn(helper,['inference-host',String(budget),process.execPath,'-e',code,'--',...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const events=[];let buffer='',logs='',began,fail;
  const started=new Promise((resolve,reject)=>{began=resolve;fail=reject;});void started.catch(()=>{});
  child.stdout.on('data',data=>{buffer+=data.toString('utf8');let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const event=JSON.parse(line);events.push(event);if(event.type==='started')began(event);}});
  child.stderr.on('data',data=>{logs=(logs+data.toString('utf8')).slice(-8192);});child.on('error',fail);
  const closed=new Promise(resolve=>child.once('close',code=>{if(!events.some(event=>event.type==='started'))fail(Error('Host did not start: '+code+' '+logs));resolve(code);}));
  return {child,started,closed,events,logs:()=>logs,stop:async()=>{child.stdin.end('stop\n');return closed;}};
}
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
(async()=>{
  const args=['alpha beta','中文','C:\\folder with space\\tail\\','a"b\\"c','&echo ignored'];
  const quote=start('process.stdout.write(JSON.stringify(process.argv.slice(1)))',args);await quote.started;assert.equal(await quote.closed,0);assert.deepEqual(JSON.parse(quote.logs()),args);
  const held=start('setInterval(()=>{},1000)'),identity=await held.started;
  const wrong=await promisify(execFile)(helper,['inference-wait',String(identity.pid),'0000000000000000','1'],{windowsHide:true});assert.equal(wrong.stdout,'');
  await assert.rejects(promisify(execFile)(helper,['inference-wait',String(identity.pid),identity.creation,'1'],{windowsHide:true}));
  assert.equal(await held.stop(),0);assert.equal(alive(identity.pid),false);
  await promisify(execFile)(helper,['inference-wait',String(identity.pid),identity.creation,'100'],{windowsHide:true});
  const limited=start('const bytes=Buffer.alloc(512*1024*1024,1);setInterval(()=>console.log(bytes.length),1000)',[],128);await limited.started;assert.equal(await limited.closed,70);assert.ok(limited.events.some(event=>event.type==='resource'));
  const tree=start('const {spawn}=require("node:child_process");const kid=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{windowsHide:true,stdio:"ignore"});console.log(JSON.stringify({kid:kid.pid}));setInterval(()=>{},1000)');
  const root=await tree.started;for(let i=0;!tree.logs().includes('kid')&&i<50;i++)await delay(20);
  const kid=JSON.parse(tree.logs().trim()).kid;tree.child.kill();await tree.closed;
  for(let i=0;(alive(root.pid)||alive(kid))&&i<50;i++)await delay(100);assert.equal(alive(root.pid),false);assert.equal(alive(kid),false);
  console.log('native inference host: argument/control isolation, graceful stop, PID identity, hard memory quota and owner-death process-tree cleanup passed');
})().catch(error=>{console.error(String(error));process.exitCode=1;});
