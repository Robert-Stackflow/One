const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('timestamp tab converts seconds and resolves ambiguous local time',async()=>{
 const profile=await mkdtemp(path.resolve('work/current/timestamp-ui-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-timestamp').click();
  await page.locator('#timestamp-zone').click();await page.locator('#timestamp-zone-options [role="option"][aria-label="UTC"]').click();await page.locator('#timestamp-number').fill('0');await page.locator('#timestamp-to-date').click();
  await expect(page.locator('#timestamp-date-result')).toContainText('1970-01-01 00:00:00.000');
  await expect(page.locator('#timestamp-now-epoch')).toContainText('毫秒');
  await page.locator('#timestamp-zone').click();await page.locator('#timestamp-zone-options [role="option"][aria-label="纽约（America/New_York）"]').click();await page.locator('#timestamp-date').fill('2024-11-03T01:30');await page.locator('#timestamp-to-epoch').click();
  await expect(page.locator('#timestamp-epoch-result')).toContainText('出现两次');
  const earlier=await page.locator('#timestamp-epoch-result').textContent();await page.locator('#timestamp-ambiguity').click();await page.locator('#timestamp-ambiguity-options [role="option"][aria-label="选择较晚的时刻"]').click();
  const later=await page.locator('#timestamp-epoch-result').textContent();assert.notEqual(later,earlier);
  await page.locator('#timestamp-date').fill('2024-03-10T02:30');await page.locator('#timestamp-to-epoch').click();await expect(page.locator('#timestamp-epoch-result')).toContainText('不存在');
  await page.locator('#timestamp-use-now').click();await expect(page.locator('#timestamp-date')).not.toHaveValue('');
  assert.deepEqual(errors,[]);
 }finally{await app.close();}
});
