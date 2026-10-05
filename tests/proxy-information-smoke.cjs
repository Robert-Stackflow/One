const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-proxy-info-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const page=await app.firstWindow();await page.locator('[data-page=hardware]').click();
  await page.locator('#information-tab-proxy').click();
  await expect(page.locator('#information-proxy')).toBeVisible();
  await expect(page.locator('.proxy-site-row')).toHaveCount(14);
  await expect(page.locator('#information-groups')).toContainText('系统代理',{timeout:25000});
  await expect(page.locator('#information-groups')).toContainText('虚拟网卡');
  await expect(page.locator('#information-highlights')).toBeHidden();
  await expect(page.locator('#information-progress')).toBeHidden();
  const local=await page.evaluate(()=>window.one.systemInformation('proxy'));
  assert.deepEqual(local.groups.map(group=>group.id),['proxy-settings','proxy-environment','proxy-processes','proxy-adapters']);
  const report=await page.evaluate(()=>window.one.proxyDiagnostics());
  assert.equal(report.sites.length,28);assert.equal(report.exits.length,2);
  assert.ok(report.sites.every(item=>['ok','restricted','failed','unavailable'].includes(item.status)));
  await expect(page.locator('#information-proxy')).toContainText('已完成');
  await fs.mkdir(path.join('work','current'),{recursive:true});await page.screenshot({path:path.join('work','current','proxy-information.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',sites:report.sites.length,proxyAvailable:report.proxyAvailable,direct:report.sites.filter(item=>item.mode==='direct'&&item.status==='ok').length,proxied:report.sites.filter(item=>item.mode==='proxy'&&item.status==='ok').length,exits:report.exits.map(item=>({mode:item.mode,status:item.status,ip:!!item.ip,country:!!item.country,coordinates:item.latitude!==undefined&&item.longitude!==undefined,asn:!!item.asn,organization:!!item.organization}))}));
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
