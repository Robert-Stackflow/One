const {_electron:electron,expect}=require('@playwright/test');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'color-picker-profile-'));
  const bundle=await build({stdin:{contents:`export * from './src/renderer/color-picker'; export {colorHSV,hsvColor} from './src/shared/colors'; export {customControls,closeControls} from './src/renderer/controls';`,resolveDir:path.resolve('.')},bundle:true,platform:'browser',format:'iife',globalName:'colors',write:false});
  const css=await fs.readFile('src/renderer/color-picker.css','utf8');
  const env={...process.env,ONE_COMPONENT_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
  try{
    app=await electron.launch({args:[path.resolve('tests/renderer-components/main.cjs')],env});
    const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setContent(`<style>:root{--surface:#fff;--fg:#202020;--muted:#737373;--line:#ddd;--hover:#eee;--accent:#333;font:13px Arial}body{margin:28px}button,input{font:inherit;border:1px solid #ddd;border-radius:6px;background:white;padding:6px}button{cursor:pointer}[hidden]{display:none!important}.row{display:flex;align-items:center;gap:20px;margin-bottom:20px}.inline-host{width:280px}.anchored-popover{animation:none!important}${css}</style>
      <form id="form"><fieldset id="fields"><div class="row"><label for="color">标注颜色</label><input type="color" id="color" value="#4c95d8"></div></fieldset></form>
      <section id="inline-host" class="inline-host"><input id="inline" type="color" value="#abcdef"></section>
      <section id="dynamic"></section><input id="unrelated" type="color" value="#ffffff"><button id="outside">outside</button>`);
    await page.evaluate(()=>{window.EyeDropper=class{open({signal}){window.eyeSignal=signal;return new Promise(resolve=>{window.eyeResolve=resolve;});}};});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    assert.equal(await page.evaluate(()=>{
      for(let r=0;r<256;r+=17)for(let g=0;g<256;g+=17)for(let b=0;b<256;b+=17){const hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''),hsv=colors.colorHSV(hex);if(colors.hsvColor(hsv.h,hsv.s,hsv.v)!==hex)return false;}return colors.hsvColor(360,1,1)==='#ff0000';
    }),true);
    assert.equal(await page.evaluate(()=>{
      window.input=document.querySelector('#color');window.inputs=0;window.changes=0;
      input.addEventListener('input',()=>inputs++);input.addEventListener('change',()=>changes++);
      window.controller=colors.setupColorPicker(input,{eyedropper:true});
      window.inlineController=colors.setupColorPicker(document.querySelector('#inline'),{inline:true});
      window.dynamicController=colors.setupColorControls(document.querySelector('#dynamic'));
      colors.customControls(document.body);
      return controller===colors.setupColorPicker(input);
    }),true);
    await expect(page.locator('#unrelated')).toBeVisible();
    await expect(page.locator('.color-picker-rgb .number-control')).toHaveCount(0);
    await expect(page.locator('#inline-host .inline-color-picker')).toBeVisible();
    assert.equal(await page.locator('#inline-panel').evaluate(el=>el.hasAttribute('popover')),false);
    await page.locator('#color-trigger').click();
    const panel=page.locator('#color-panel');await expect(panel).toBeVisible();
    await expect(panel.locator('.color-picker-hex input')).toHaveValue('#4C95D8');
    assert.equal(await panel.evaluate(el=>el.offsetWidth),260);
    await page.evaluate(()=>colors.closeControls());await expect(panel).toBeHidden();
    await page.locator('#color-trigger').click();
    await panel.locator('[data-color="#de4747"]').click();
    await expect(page.locator('#color')).toHaveValue('#de4747');
    assert.equal(await page.evaluate(()=>changes),1);
    await panel.locator('.color-picker-hex input').fill('123456');
    await page.keyboard.press('Tab');await expect(page.locator('#color')).toHaveValue('#123456');
    const rgb=panel.locator('.color-picker-rgb input');await expect(rgb.nth(0)).toHaveValue('18');
    await rgb.nth(1).fill('200');await page.keyboard.press('Tab');
    await expect(page.locator('#color')).toHaveValue('#12c856');
    await panel.locator('.color-picker-hex input').fill('bad');await page.keyboard.press('Tab');
    await expect(panel.locator('.color-picker-hex input')).toHaveValue('#12C856');
    await rgb.nth(1).fill('300');await page.keyboard.press('Tab');
    await expect(page.locator('#color')).toHaveValue('#12c856');
    await page.evaluate(()=>input.value='#ff0000');
    await expect(panel.locator('.color-picker-hex input')).toHaveValue('#FF0000');
    const before=await page.evaluate(()=>changes);
    const rect=await panel.locator('.color-picker-plane').boundingBox();
    await page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.2);await page.mouse.down();
    await page.mouse.move(rect.x+rect.width*.75,rect.y+rect.height*.4);
    assert.equal(await page.evaluate(()=>changes),before);
    await page.mouse.up();assert.equal(await page.evaluate(()=>changes),before+1);
    await panel.locator('.color-picker-plane').focus();await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>changes),before+2);
    await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(page.locator('#color-trigger')).toBeFocused();
    await page.evaluate(()=>document.querySelector('#form').reset());
    await expect(page.locator('#color-trigger .color-picker-value')).toHaveText('#4C95D8');
    await page.evaluate(()=>input.click());await expect(panel).toBeVisible();
    await page.evaluate(()=>document.querySelector('#fields').disabled=true);
    await expect(page.locator('#color-trigger')).toBeDisabled();await expect(panel).toBeHidden();
    await page.evaluate(()=>document.querySelector('#fields').disabled=false);
    await page.locator('#color-trigger').click();
    await panel.locator('.color-picker-eyedropper').click();
    await page.evaluate(()=>input.disabled=true);
    await expect.poll(()=>page.evaluate(()=>eyeSignal.aborted)).toBe(true);
    await page.evaluate(()=>eyeResolve({sRGBHex:'#ffffff'}));await expect(page.locator('#color')).toHaveValue('#4c95d8');
    await page.evaluate(()=>{input.disabled=false;const next=document.createElement('input');next.type='color';next.id='new';next.value='#abcdef';document.querySelector('#dynamic').append(next);});
    await expect(page.locator('#new-trigger')).toHaveCount(1);
    await page.locator('#new-trigger').click();await expect(page.locator('#new-panel')).toBeVisible();
    await page.evaluate(()=>document.querySelector('#dynamic').remove());
    await expect(page.locator('#new-panel')).toHaveCount(0);
    await page.locator('#inline-panel [data-color="#5eaa71"]').click();await expect(page.locator('#inline')).toHaveValue('#5eaa71');
    await page.evaluate(()=>{controller.dispose();controller.dispose();inlineController.dispose();});
    await expect(page.locator('#color')).toBeVisible();await expect(panel).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Object.hasOwn(input,'value')),false);
    assert.deepEqual(errors,[]);
    console.log('Color controls: 4096 HSV round trips, scoped/inline layout, HEX/RGB/presets/drag/keyboard, native synchronization, fieldset/reset, cancelled eyedropper and disposal passed.');
  }finally{await app?.close();const resolved=await fs.realpath(profile);assert.ok(resolved.startsWith(root+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
