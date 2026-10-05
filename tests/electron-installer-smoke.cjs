const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('.');
  const version = require('../package.json').version;
  const output = path.resolve(process.env.ONE_INSTALLER_OUTPUT || path.join(root, 'work', 'installer-output', version));
  const info = path.join(output, 'electron-installer-build', 'build-info.json');
  const engine = path.join(output, `One-${version}-Setup-Engine-x64.exe`);
  assert(fs.existsSync(info) && fs.existsSync(engine), 'Build the Electron installer first');
  const packaged = process.env.ONE_INSTALLER_PACKAGED === '1';
  const app = await electron.launch({executablePath:packaged ? path.join(output,'electron-installer-build','win-unpacked','OneSetup.exe') : path.join(root,'node_modules/electron/dist/electron.exe'),args:packaged ? [] : [path.join(root,'installer')],cwd:root,env:packaged ? process.env : {...process.env,ONE_INSTALLER_BUILD_INFO:info,ONE_INSTALLER_PAYLOAD:engine}});
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(()=>document.querySelector('#version').textContent.startsWith('版本'));
    await page.getByRole('heading',{name:'安装 One'}).waitFor();
    await page.waitForFunction(() => document.querySelector('#directory').value.length > 0);
    assert.match(await page.locator('#directory').inputValue(),/\\One$/i);
    const selection=await page.evaluate(()=>({body:getComputedStyle(document.body).userSelect,input:getComputedStyle(document.querySelector('#directory')).userSelect}));
    assert.deepEqual(selection,{body:'none',input:'text'});
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:['D:\\Apps']});});
    await page.getByRole('button',{name:'浏览'}).click();
    assert.equal(await page.locator('#directory').inputValue(),'D:\\Apps\\One');
    await page.locator('#directory').fill('D:\\Tools');
    await page.locator('#directory').blur();
    assert.equal(await page.locator('#directory').inputValue(),'D:\\Tools\\One');
    await page.locator('#directory').fill('invalid');
    await page.getByRole('button',{name:'开始安装'}).click();
    assert.match(await page.locator('#path-error').innerText(),/有效的安装位置/);
    await page.locator('#directory').fill('D:\\Programs\\One');
    await page.locator('#directory').blur();
    assert.equal(await page.locator('#path-error').innerText(),'');
    const preview=path.join(output,packaged?'electron-installer-packaged-preview.png':'electron-installer-preview.png');
    await page.screenshot({path:preview});
    console.log(JSON.stringify({passed:true,renderer:'Electron',packaged,directoryEditable:true,automaticOneDirectory:true,selectionRestricted:true,invalidPathGuard:true,preview}));
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
