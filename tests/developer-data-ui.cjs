const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('developer data tab works in the full window',async()=>{
 const profile=await mkdtemp(path.resolve('work/current/developer-tools/profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};
 delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();
  await page.locator('#tool-tab-developer-data').click();
  await expect(page.locator('#page-developer-data')).toBeVisible();
  await expect(page.locator('#developer-data-format')).toHaveAttribute('aria-label','输入格式');
  await expect(page.locator('#barcode-heading-actions')).toBeHidden();
  await page.locator('#developer-data-input').fill('{"name":"中文","count":2}');
  await page.locator('[data-data-action="format"]').click();
  await expect(page.locator('#developer-data-status')).toContainText('已格式化');
  assert.deepEqual(JSON.parse(await page.locator('#developer-data-output').inputValue()),{name:'中文',count:2});
  await page.locator('[data-data-action="convert"]').click();
  await expect(page.locator('#developer-data-status')).toContainText('已转换为 YAML');
  assert.match(await page.locator('#developer-data-output').inputValue(),/name: 中文/);
  await page.locator('#developer-data-input').fill('{\n  "x":,\n}');
  await page.locator('[data-data-action="validate"]').click();
  await expect(page.locator('#developer-data-status')).toContainText('第 2 行');
  assert.equal(await page.locator('#developer-data-input').evaluate(el=>el.selectionStart),8);
  await page.locator('#developer-data-format').click();await page.locator('#developer-data-format-options [role="option"][aria-label="YAML"]').click();
  await page.locator('#developer-data-input').fill('enabled: true\nname: 中文');
  await page.locator('[data-data-action="convert"]').click();
  await expect(page.locator('#developer-data-status')).toContainText('已转换为 JSON');
  assert.deepEqual(JSON.parse(await page.locator('#developer-data-output').inputValue()),{enabled:true,name:'中文'});
  await page.locator('#tool-tab-barcode').click();
  await expect(page.locator('#page-barcode')).toBeVisible();
  await expect(page.locator('#barcode-heading-actions')).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await app.close();}
});
