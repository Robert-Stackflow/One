const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const {mkdir,mkdtemp,writeFile}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const run=promisify(execFile);
const root=resolve(__dirname,'..'),output=process.env.ONE_TEST_OUTPUT_DIR||join(root,'work','hotkey-probe-test');
const native=join(root,'dist','native');

function lines(child){
  const values=[];let pending='',waiters=[];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',part=>{pending+=part;let at;while((at=pending.indexOf('\n'))>=0){
    const line=pending.slice(0,at);pending=pending.slice(at+1);
    let value;try{value=JSON.parse(line);}catch{continue;}
    values.push(value);for(const waiter of waiters)waiter();waiters=[];
  }});
  return async(predicate,timeout=10000)=>{
    const until=Date.now()+timeout;
    while(true){const index=values.findIndex(predicate);if(index>=0)return values.splice(index,1)[0];
      const left=until-Date.now();if(left<=0)throw new Error(`Timed out waiting for ${child.spawnfile}; lines=${JSON.stringify(values)}`);
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters=waiters.filter(item=>item!==done);reject(new Error(`Timed out waiting for ${child.spawnfile}`));},left);const done=()=>{clearTimeout(timer);resolve();};waiters.push(done);});
    }
  };
}

async function build(installation,arch){
  const file=join(output,`build-${arch}.cmd`),target=join(output,`target-${arch}.exe`);
  await writeFile(file,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars${arch}.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /DUNICODE /D_UNICODE "${join(root,'tests','hotkey-probe-target.cpp')}" /Fe:"${target}" /Fo:"${join(output,`target-${arch}.obj`)}" /link /SUBSYSTEM:CONSOLE /ENTRY:wmainCRTStartup user32.lib\r\n`);
  await run('cmd.exe',['/d','/c',file],{cwd:root,windowsHide:true});return target;
}

async function main(){
  await mkdir(output,{recursive:true});
  const vswhere=join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio','Installer','vswhere.exe');
  const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath']);
  const installation=stdout.trim();assert.ok(installation,'Visual Studio C++ tools are required');
  for(const arch of [64,32]){
    const file=await build(installation,arch);
    const target=spawn(file,[],{windowsHide:true,stdio:'pipe'}),targetLine=lines(target);
    let broker;
    try{
      assert.deepEqual(await targetLine(value=>value.ready||value.error),{ready:true});
      broker=spawn(join(native,'One.HotkeyProbe.exe'),['--broker'],{windowsHide:true,stdio:'pipe'});
      const brokerLine=lines(broker);
      assert.deepEqual(await brokerLine(value=>value.ready),{ready:true});
      const scanner=await run(join(native,'One.HotkeyProbe.exe'),['--scan','134','7','auto'],{windowsHide:true,timeout:15000});
      assert.equal(scanner.stderr,'');
      const result=await brokerLine(value=>value.status,5000);
      assert.equal(result.status,'found',JSON.stringify(result));
      assert.equal(result.pid,target.pid,JSON.stringify(result));
      assert.equal(result.partial,false,JSON.stringify(result));
      await new Promise(resolve=>setTimeout(resolve,150));
      let triggered=false;
      try{await targetLine(value=>value.triggered,100);triggered=true;}catch{}
      assert.equal(triggered,false,'Observed WM_HOTKEY must be suppressed after attribution');
      process.stdout.write(`Hotkey probe ${arch}-bit target: PID ${result.pid}, suppressed\n`);
      if(arch===64){
        const {_electron:electron}=require('@playwright/test');
        const profile=await mkdtemp(join(output,'electron-'));
        const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
        const app=await electron.launch({args:[root],env});
        try{
          const page=await app.firstWindow();await page.waitForSelector('[data-page=settings]');
          const answer=await page.evaluate(()=>window.one.hotkeyOwner('Ctrl+Alt+Shift+F23','auto',false));
          assert.equal(answer.status,'found',JSON.stringify(answer));
          assert.equal(answer.pid,target.pid,JSON.stringify(answer));
          process.stdout.write('Electron IPC hotkey owner lookup: found target\n');
          await page.locator('[data-page=color]').click();
          await page.locator('#color-shortcut').focus();
          await page.evaluate(()=>{
            document.querySelector('#color-shortcut').dispatchEvent(new KeyboardEvent('keydown',{
              key:'F23',code:'F23',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true,
            }));
          });
          await page.locator('#color-shortcut').blur();
          const notice=page.locator('#color-shortcut-notice');
          await notice.getByRole('button',{name:'详情'}).click();
          const detail=page.locator('#color-shortcut-details-dialog');
          await detail.getByRole('button',{name:'自动定位'}).click();
          await detail.locator('[data-shortcut-owner]').filter({hasText:`target-64.exe（PID ${target.pid}）`}).waitFor({timeout:15000});
          await detail.locator('[data-dialog-dismiss]').click();
          await detail.waitFor({state:'hidden'});
          assert.ok((await notice.boundingBox()).height<35,'Inline shortcut notice should stay compact');
          await page.screenshot({path:join(output,'shortcut-owner.png')});
          process.stdout.write('Shared shortcut field: shows identified process\n');
        }finally{await app.close();}
      }
    }finally{broker?.kill();target.kill();}
  }
  const broker=spawn(join(native,'One.HotkeyProbe.exe'),['--broker'],{windowsHide:true,stdio:'pipe'});
  try{
    const brokerLine=lines(broker);
    await brokerLine(value=>value.ready);
    await run(join(native,'One.HotkeyProbe.exe'),['--scan','135','7','auto'],{windowsHide:true,timeout:15000});
    const result=await brokerLine(value=>value.status,5000);
    assert.equal(result.status,'not-found',JSON.stringify(result));
    process.stdout.write('Hotkey probe unclaimed combination: not found\n');
  }finally{broker.kill();}
  const cancelledBroker=spawn(join(native,'One.HotkeyProbe.exe'),['--broker'],{windowsHide:true,stdio:'pipe'});
  const cancelledLine=lines(cancelledBroker);
  await cancelledLine(value=>value.ready);
  const scanner=spawn(join(native,'One.HotkeyProbe.exe'),['--scan','135','7','manual'],{windowsHide:true,stdio:'pipe'});
  scanner.stderr.resume();scanner.stdout.resume();
  await new Promise(resolve=>setTimeout(resolve,300));
  cancelledBroker.kill();
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Scanner remained active after broker exit')),3000);
    scanner.once('exit',()=>{clearTimeout(timer);resolve();});
  });
  process.stdout.write('Hotkey probe cancellation: scanner exited\n');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
