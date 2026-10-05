const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');

async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-color-loupe-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env}:{args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.locator('[data-page="color"]').click();
  await page.locator('#start-color').waitFor();
  const opened=app.waitForEvent('window');await page.locator('#start-color').click();const loupe=await opened;
  await expect(loupe.locator('.live-loupe')).toBeVisible();
  const style=await loupe.locator('.live-loupe').evaluate(element=>{
   const box=element.getBoundingClientRect(),css=getComputedStyle(element);
   return{width:box.width,height:box.height,background:css.backgroundColor,radius:css.borderRadius,selected:css.userSelect};
  });
  assert.deepEqual(style,{width:200,height:260,background:'rgb(36, 36, 36)',radius:'13px',selected:'none'});
  const output=path.resolve('work/current/color-loupe-style.png');await fs.mkdir(path.dirname(output),{recursive:true});await loupe.screenshot({path:output});
  console.log(JSON.stringify({result:'PASS',style,output,packaged:!!process.env.ONE_PACKAGED_EXE}));
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
