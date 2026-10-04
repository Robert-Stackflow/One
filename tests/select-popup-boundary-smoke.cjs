const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/select-popup-boundary');await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(output,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const page=await app.firstWindow();await page.waitForSelector('[data-page=input]');await (await app.browserWindow(page)).evaluate(w=>w.setSize(840,620));
  await page.locator('[data-page=input]').click();await page.locator('#enhancement-tab-awake').click();
  await page.locator('#awake-mode').evaluate(button=>{button.dispatchEvent(new CustomEvent('one:options',{detail:[{label:'很长的选项路径 '.repeat(80),value:'long'},{label:'短选项',value:'short'}]}));button.value='long';});
  const measure=()=>page.locator('.select-popup').evaluate(menu=>{const r=menu.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,viewportWidth:innerWidth,viewportHeight:innerHeight,placement:menu.dataset.placement,scrollWidth:menu.scrollWidth,clientWidth:menu.clientWidth};});
  const bounded=r=>{assert.ok(r.left>=7&&r.right<=r.viewportWidth-7,JSON.stringify(r));assert.ok(r.top>=7&&r.bottom<=r.viewportHeight-7,JSON.stringify(r));assert.ok(r.scrollWidth<=r.clientWidth+1,JSON.stringify(r));};
  await page.locator('#awake-mode').click();await expect(page.locator('.select-popup')).toBeVisible();const nearMiddle=await measure();bounded(nearMiddle);
  await page.keyboard.press('Escape');await expect(page.locator('.select-popup')).toHaveCount(0);
  await page.locator('#awake-mode').evaluate(button=>{Object.assign(button.style,{position:'fixed',right:'12px',bottom:'12px',width:'116px',zIndex:'100'});});
  await page.locator('#awake-mode').click();await expect(page.locator('.select-popup')).toBeVisible();const corner=await measure();bounded(corner);assert.equal(corner.placement,'above');
  await page.screenshot({path:path.join(output,'upper-popup.png'),animations:'disabled'});
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.locator('.select-popup')).toHaveCount(0);await expect(page.locator('#awake-mode')).toBeFocused();
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#awake-mode').click();assert.equal(await page.locator('.select-popup').evaluate(menu=>getComputedStyle(menu).animationName),'none');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',nearMiddle,corner,keyboard:true,reducedMotion:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
