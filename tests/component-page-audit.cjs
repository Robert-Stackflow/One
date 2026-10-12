const {test}=require('node:test'),assert=require('node:assert/strict'),{_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');

test('main pages use the shared controls without duplicate ids or layout overflow',async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-component-audit-'));
 const files=path.join(profile,'files');await fs.mkdir(files);await fs.writeFile(path.join(files,'sample.zip'),'fixture');
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const page=await app.firstWindow();await page.waitForSelector('[data-page=home]');
  const ids=['home','tools','text','search','disk','archive','input','preview','developer','images','system','hardware','settings'];
  const report=[];
  for(const id of ids){
   await page.locator(`[data-page=${id}]`).click();await expect(page.locator(`#page-${id}`)).toBeVisible();
   const result=await page.locator(`#page-${id}`).evaluate(root=>{
    const ids=[...root.querySelectorAll('[id]')].map(node=>node.id),duplicates=ids.filter((value,index)=>ids.indexOf(value)!==index);
    const tabs=[...root.querySelectorAll('[role=tab][aria-controls]')].filter(node=>!document.getElementById(node.getAttribute('aria-controls'))).map(node=>node.id);
    return{nativeSelects:root.querySelectorAll('select').length,duplicateIds:[...new Set(duplicates)],brokenTabs:tabs,horizontalOverflow:Math.max(0,root.scrollWidth-root.clientWidth)};
   });
   report.push({page:id,...result});
   assert.deepEqual(result.duplicateIds,[],`${id}: duplicate ids`);
   assert.deepEqual(result.brokenTabs,[],`${id}: broken tab targets`);
   assert.equal(result.nativeSelects,0,`${id}: native select instead of shared control`);
   assert.ok(result.horizontalOverflow<8,`${id}: ${result.horizontalOverflow}px horizontal overflow`);
  }
  await page.evaluate(async root=>{await window.one.patchSettings({search:{roots:[root]}});await window.one.showSearch();},files);
  await expect.poll(()=>app.windows().some(window=>window.url().includes('view=search'))).toBe(true);
  const search=app.windows().find(window=>window.url().includes('view=search'));
  await search.locator('#file-query').fill('sample');
  await expect(search.locator('.search-filter-row')).toBeVisible();
  await expect(search.locator('#search-scope.custom-select')).toBeVisible();
  assert.equal(await search.locator('.search-scope-field').innerText(),'全部索引');
  const tabGap=await search.locator('.search-filter-row .tabs').evaluate(strip=>strip.getBoundingClientRect().right-strip.lastElementChild.getBoundingClientRect().right);
  assert.ok(tabGap<=6,`Search tab background stretches ${tabGap}px past its last button`);
  await search.locator('#search-scope').click();
  await expect(search.locator('#search-scope-options')).toBeVisible();
  await search.locator('#search-scope').press('Escape');
  await expect(search.locator('#search-scope')).toBeVisible();
  await search.locator('#search-scope').click();
  await search.locator('#search-scope-options [role=option]').last().click();
  assert.equal(await search.locator('#search-scope').evaluate(button=>button.value),files);
  await search.locator('#file-query').fill('.zip');
  await expect(search.locator('.search-result strong').first()).toHaveText('sample.zip',{timeout:15000});
  await search.locator('#file-query').fill('>wjss');
  await expect(search.locator('.search-result strong').first()).toHaveText('打开文件搜索设置');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pages:report.length,sharedSelects:true,searchTabGap:tabGap}));
 }finally{await app.close().catch(()=>{});const resolved=await fs.realpath(profile).catch(()=>null);if(resolved&&resolved.startsWith(path.resolve(os.tmpdir(),'one-component-audit-')))await fs.rm(resolved,{recursive:true,force:true});}
});
