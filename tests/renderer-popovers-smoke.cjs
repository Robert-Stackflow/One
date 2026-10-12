const {_electron:electron,expect}=require('@playwright/test');
const {build}=require('esbuild');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'popovers-profile-'));
  const bundle=await build({stdin:{contents:`export * from './src/renderer/anchored-popover'; export * from './src/renderer/confirm-popover';export * from './src/renderer/capture/appearance';`,resolveDir:path.resolve('.')},bundle:true,platform:'browser',format:'iife',globalName:'popovers',write:false});
  const env={...process.env,ONE_COMPONENT_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try{
    app=await electron.launch({args:[path.resolve('tests/renderer-components/main.cjs')],env});
    const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setContent(`<style>body{margin:0}.anchored-popover{position:fixed;inset:auto;margin:0;box-sizing:border-box;overflow:auto}#anchor{position:fixed;bottom:20px;right:12px;width:80px;height:28px}#popup{padding:10px}#content{height:900px}.confirmation-popover{padding:12px}#boundary{width:360px}</style><div id="boundary"></div><button id="anchor">open</button><div id="popup"><div id="content">Tall content</div></div><button id="outside">outside</button>`);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      window.anchor=document.querySelector('#anchor');window.popup=document.querySelector('#popup');window.limit=400;window.detaches=0;
      window.options={preferred:'above',gap:8,width:1000,maxHeight:()=>limit,boundary:document.querySelector('#boundary'),onDetach:()=>detaches++};
      popovers.openAnchoredPopover(anchor,popup,options);
    });
    await expect(page.locator('#popup')).toHaveAttribute('data-side','above');
    assert.equal(await page.locator('#popup').evaluate(el=>el.offsetWidth),344);
    assert.equal(await page.locator('#popup').evaluate(el=>el.offsetHeight),400);
    const normalFont=await page.locator('#outside').evaluate(el=>getComputedStyle(el).fontSize);
    await page.evaluate(()=>{const root=document.createElement('section');root.id='capture-root';document.body.append(root);root.append(anchor);popovers.applyCaptureScale(root,125);});
    await expect.poll(()=>page.locator('#popup').evaluate(el=>getComputedStyle(el).fontSize)).toBe('16.25px');
    assert.equal(await page.locator('#outside').evaluate(el=>getComputedStyle(el).fontSize),normalFont);
    await page.evaluate(()=>popovers.applyCaptureScale(document.querySelector('#capture-root'),150));
    await expect.poll(()=>page.locator('#popup').evaluate(el=>getComputedStyle(el).fontSize)).toBe('19.5px');
    await page.evaluate(()=>{document.body.append(anchor);popovers.openAnchoredPopover(anchor,popup,options);});
    assert.equal(await page.locator('#popup').getAttribute('data-capture-scale'),null);
    assert.equal(await page.locator('#popup').evaluate(el=>el.style.fontSize),'');
    await page.evaluate(()=>document.querySelector('#boundary').style.width='260px');
    await expect.poll(()=>page.locator('#popup').evaluate(el=>el.offsetWidth)).toBe(244);
    await page.evaluate(()=>{limit=200;anchor.style.top='10px';anchor.style.bottom='auto';window.dispatchEvent(new Event('resize'));});
    await expect(page.locator('#popup')).toHaveAttribute('data-side','below');
    await expect.poll(()=>page.locator('#popup').evaluate(el=>el.offsetHeight)).toBe(200);
    const bounded=await page.locator('#popup').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=8&&r.top>=8&&r.right<=innerWidth-8&&r.bottom<=innerHeight-8;});assert.equal(bounded,true);

    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{window.oldClose=popovers.closeAnchoredPopover(popup,{remove:true});popovers.openAnchoredPopover(anchor,popup,options);});
    assert.equal(await page.evaluate(()=>oldClose),false);
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#popup').evaluate(el=>el.matches(':popover-open')&&!el.inert),true);
    await page.evaluate(()=>anchor.remove());
    await expect.poll(()=>page.evaluate(()=>detaches)).toBe(1);
    assert.equal(await page.locator('#popup').evaluate(el=>el.matches(':popover-open')),false);
    await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));document.body.append(anchor);popovers.openAnchoredPopover(anchor,popup,options);});
    await page.evaluate(()=>popup.remove());
    await expect.poll(()=>page.evaluate(()=>detaches)).toBe(2);

    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{window.confirmed=0;popovers.confirmPopover(anchor,'删除条目','保留取消行为',()=>confirmed++);});
    await expect(page.locator('#confirmation-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.confirmation-popover')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>confirmed),0);await expect(page.locator('#anchor')).toBeFocused();
    await page.evaluate(()=>popovers.confirmPopover(anchor,'删除条目','确认后执行',()=>confirmed++));
    await page.locator('#confirmation-accept').click();
    await expect(page.locator('.confirmation-popover')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>confirmed),1);
    await page.evaluate(()=>popovers.confirmPopover(anchor,'删除条目','点击外部取消',()=>confirmed++));
    await page.locator('#outside').click();
    await expect(page.locator('.confirmation-popover')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>confirmed),1);
    assert.deepEqual(errors,[]);
    console.log('Popovers: constrained sizing, boundary resize, placement, scoped capture scale/portal updates, interrupted close, reopen/detach, reduced motion and existing One confirmation passed.');
  }finally{await app?.close();const resolved=await fs.realpath(profile);assert.ok(resolved.startsWith(root+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
