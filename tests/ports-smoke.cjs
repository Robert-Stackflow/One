const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');

async function run(){
 const root=path.resolve('.'),profile=await fs.mkdtemp(path.join(root,'work','ports-smoke-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root],env});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.waitForSelector('[data-page=system]');await expect(page.locator('[data-page=ports]')).toHaveText('端口服务');await page.locator('[data-page=system]').click();await expect(page.locator('[data-maintenance-tab]')).toHaveCount(4);
  await page.locator('[data-page=ports]').click();await expect(page.locator('#page-name')).toHaveText('端口服务');await expect(page.locator('#ports-tab')).toBeVisible();await page.locator('[data-page=hardware]').click();
  await page.evaluate(()=>window.one.showSearch());
  await expect.poll(()=>app.windows().some(candidate=>candidate.url().includes('view=search')&&!candidate.url().includes('embedded'))).toBe(true);
  const search=app.windows().find(candidate=>candidate.url().includes('view=search')&&!candidate.url().includes('embedded'));
  await search.locator('#file-query').fill('>端口');await expect(search.locator('.search-result').filter({hasText:'打开网络端口'})).toHaveCount(1);
  await search.locator('.search-result').filter({hasText:'打开网络端口'}).dblclick();
  await expect(page.locator('#ports-tab')).toHaveAttribute('aria-selected','true');
  await page.waitForSelector('#ports-table .ports-row',{timeout:30_000});
  const ports=await page.locator('#ports-table .ports-row').count();assert.ok(ports>0);
  await page.locator('#ports-query').fill('definitely-no-port-process');await expect(page.locator('.ports-empty')).toHaveText('没有匹配的端口');
  await page.locator('#ports-query').fill('');await page.locator('#services-tab').click();await expect(page.locator('#services-tab')).toHaveAttribute('aria-selected','true');await page.waitForSelector('#ports-table .ports-row',{timeout:30_000});
  const services=await page.locator('#ports-table .ports-row').count();assert.ok(services>0);
  await expect(page.locator('#page-name')).toHaveText('端口服务');assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',ports,services,independentNavigation:true,legacySearchEntry:true}));
 }finally{const child=app.process(),pid=await app.evaluate(()=>process.pid).catch(()=>0),timer=setTimeout(()=>{if(pid)try{process.kill(pid,'SIGKILL');}catch{}},3000);await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,6000))]);clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
