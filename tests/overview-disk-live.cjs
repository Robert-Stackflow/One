const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-overview-live-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#overview-free');
  async function sample(free){await app.evaluate(({BrowserWindow},value)=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main'));if(!main)throw Error('Main window missing');main.webContents.send('one:disk-monitor',{volumes:[{drive:'X:\\',label:'Live test',filesystem:'NTFS',total:100*1024**3,free:value,type:3}]});},free);}
  await sample(40*1024**3);await expect(page.locator('#overview-free')).toHaveText('40.000 GB',{timeout:3000});
  await sample(40*1024**3-2*1024**2);await expect(page.locator('#overview-free')).toHaveText('39.998 GB',{timeout:3000});
  await expect(page.locator('#overview-volumes')).toContainText('39.998 GB 可用');
  assert.equal(await page.locator('#overview-volume-count').textContent(),'1 个磁盘');
  console.log('PASS overview free space updates from monitor samples');
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
