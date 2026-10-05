// Uses the isolated NSIS identity produced by installer-lifecycle.cjs.
// It exercises the Electron screen, an initial install, and changing location.
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn,spawnSync} = require('node:child_process');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (file,args) => new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});

(async()=>{
  const root=path.resolve('.');
  const result=JSON.parse(fs.readFileSync('work/installer-lifecycle-results.json','utf8'));
  const id=path.basename(result.folder);
  assert(/^[0-9a-f-]{36}$/.test(id));
  const product=`OneVerification-${id}`;
  const payload=path.join(result.folder,'build','verification-setup.exe');
  const asar=path.join(result.folder,'build','win-unpacked','resources','app.asar');
  const testRoot=path.join(result.folder,`electron-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(testRoot,{recursive:true});
  const infoFile=path.join(testRoot,'build-info.json');
  fs.writeFileSync(infoFile,JSON.stringify({version:require('../package.json').version,product,guid:id,engineHash:sha(payload),engineBytes:fs.statSync(payload).size,asarHash:sha(asar)}));
  const parents=[path.join(testRoot,'初次安装 with spaces'),path.join(testRoot,'新安装位置')];
  const folders=parents.map(folder=>path.join(folder,'One'));
  const key=`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}`;
  assert.notEqual(spawnSync('reg.exe',['query',key],{windowsHide:true,stdio:'ignore'}).status,0,'Fixture must start uninstalled');
  let installed='';
  let blocker;
  try {
    for(const [index,directory] of folders.entries()){
      if(index===0){
        fs.mkdirSync(directory,{recursive:true});
        const blockedExe=path.join(directory,`${product}.exe`);
        fs.copyFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','ping.exe'),blockedExe);
        blocker=spawn(blockedExe,['127.0.0.1','-t'],{windowsHide:true,stdio:'ignore'});
        await sleep(500);
        assert.equal(blocker.exitCode,null,'Fixture process must be running');
      }
      if(index===1){
        const failing=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'installer')],cwd:root,env:{...process.env,ONE_INSTALLER_BUILD_INFO:infoFile,ONE_INSTALLER_PAYLOAD:payload,ONE_INSTALLER_TEST_FAIL_AFTER_REMOVE:'1'}});
        try{
          const page=await failing.firstWindow();
          await page.waitForFunction(()=>document.querySelector('#directory').value.length>0);
          await page.locator('#directory').fill(parents[index]);
          await page.getByRole('button',{name:'开始安装'}).click();
          await page.locator('#failed.active').waitFor({timeout:180000});
          assert(fs.existsSync(path.join(folders[0],`${product}.exe`)),'Previous program must be restored');
          assert.equal(sha(path.join(folders[0],'resources','app.asar')),sha(asar));
          assert.equal(spawnSync('reg.exe',['query',key],{windowsHide:true,stdio:'ignore'}).status,0,'Previous registration must be restored');
          assert(!fs.existsSync(path.join(folders[1],`${product}.exe`)));
        }finally{await failing.close();}
      }
      const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'installer')],cwd:root,env:{...process.env,ONE_INSTALLER_BUILD_INFO:infoFile,ONE_INSTALLER_PAYLOAD:payload}});
      app.process().stderr?.on('data',chunk=>process.stderr.write(chunk));
      try {
        const page=await app.firstWindow();
        await page.waitForFunction(()=>document.querySelector('#directory').value.length>0);
        if(index===1) assert.equal(await page.locator('#directory').inputValue(),folders[0],'Existing location is shown');
        await page.locator('#directory').fill(parents[index]);
        await page.getByRole('button',{name:'开始安装'}).click();
        if(index===0){
          await page.locator('#running.active').waitFor({timeout:20000});
          assert.equal(blocker.exitCode,null,'Installation must wait while One is running');
          await page.screenshot({path:path.join(testRoot,'one-running.png')});
          await page.getByRole('button',{name:'退出 One',exact:true}).click();
          await page.getByRole('button',{name:'强制退出 One'}).waitFor({timeout:20000});
          await page.getByRole('button',{name:'强制退出 One'}).click();
        }
        await page.waitForFunction(()=>document.querySelector('#done').classList.contains('active')||document.querySelector('#failed').classList.contains('active'),null,{timeout:180000});
        assert(await page.locator('#done').evaluate(node=>node.classList.contains('active')),await page.locator('#failure-message').innerText());
        installed=directory;
        assert(fs.existsSync(path.join(directory,`${product}.exe`)));
        assert.equal(sha(path.join(directory,'resources','app.asar')),sha(asar));
        if(index===1) assert(!fs.existsSync(path.join(folders[0],`${product}.exe`)),'Old program files removed after changing location');
        assert.equal(spawnSync('reg.exe',['query',key],{windowsHide:true,stdio:'ignore'}).status,0);
      } finally {await app.close();}
    }
    const uninstaller=fs.readdirSync(installed).find(name=>/^Uninstall.*\.exe$/i.test(name));
    assert(uninstaller);
    assert.equal(await run(path.join(installed,uninstaller),['/S']),0);
    for(let i=0;i<100;i++){
      if(!fs.existsSync(path.join(installed,`${product}.exe`))&&spawnSync('reg.exe',['query',key],{windowsHide:true,stdio:'ignore'}).status!==0)break;
      await sleep(100);
    }
    assert(!fs.existsSync(path.join(installed,`${product}.exe`)));
    assert.notEqual(spawnSync('reg.exe',['query',key],{windowsHide:true,stdio:'ignore'}).status,0,'Uninstall registration must be removed');
    installed='';
    console.log(JSON.stringify({passed:true,electronUI:true,realNsisEngine:true,installLocationChanged:true,failedUpgradeRestored:true,verifiedAsar:true,isolatedIdentity:true}));
  } finally {
    if(blocker?.exitCode===null)blocker.kill();
    if(installed&&fs.existsSync(installed)){
      const uninstaller=fs.readdirSync(installed).find(name=>/^Uninstall.*\.exe$/i.test(name));
      if(uninstaller) await run(path.join(installed,uninstaller),['/S']);
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
