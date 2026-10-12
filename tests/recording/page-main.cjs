const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const directory=process.env.ONE_RECORDING_PAGE_TEST_DIR;
app.setPath('userData',path.join(directory,'profile'));app.setPath('crashDumps',path.join(directory,'crashes'));
const timeout=setTimeout(()=>app.exit(1),40000);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1280,height:860,webPreferences:{preload:path.join(directory,'preload.cjs'),backgroundThrottling:false,sandbox:true}});
  await window.loadFile(path.join(directory,'index.html'));
  const report=await window.webContents.executeJavaScript("window.runRecordingPageTests().catch(error=>{throw Error(error.message+'; notice='+(document.getElementById('recording-toast')?.textContent||''));})");
  if(process.env.ONE_RECORDING_PAGE_SCREENSHOT==='1'){
    await window.webContents.executeJavaScript('window.previewRecordingPage()');
    window.showInactive();
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const captured=await window.webContents.capturePage();
    await fs.writeFile(path.join(directory,'../recording-page.png'),captured.resize({width:1280}).toPNG());
    await window.webContents.executeJavaScript('window.disposeRecordingPreview()');
  }
  console.log(JSON.stringify(report));window.destroy();
}).catch(error=>{console.error(String(error.stack||error).slice(0,4000));process.exitCode=1;}).finally(()=>{clearTimeout(timeout);app.exit(process.exitCode||0);});
