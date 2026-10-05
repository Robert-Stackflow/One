const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/choice-performance');await fs.mkdir(output,{recursive:true});const profile=await fs.mkdtemp(path.join(output,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');
  await main.locator('[data-page=input]').click();await main.locator('#enhancement-tab-quick').click();
  const numberControls=await main.evaluate(()=>[...document.querySelectorAll('#page-input input[type=number]')].map(input=>{let wrappers=0;for(let node=input.parentElement;node;node=node.parentElement)if(node.matches('.number-control'))wrappers++;return{id:input.id,wrappers};}));
  assert.ok(numberControls.length>0,'操作增强页应包含数字控件');
  await expect(main.locator('#quick-volume-step-row')).toBeHidden();
  await main.locator('#quick-volume').check();await expect(main.locator('#quick-volume-step-row')).toBeVisible();
  await main.locator('#quick-volume').uncheck();await expect(main.locator('#quick-volume-step-row')).toBeHidden();
  await main.locator('[data-page=text]').click();await main.locator('#text-operation').click();await expect(main.locator('.select-popup')).toBeVisible();
  const measure=async(control,list)=>main.evaluate(({control,list})=>{
   const button=document.querySelector(control),root=document.querySelector(list),rows=[...root.querySelectorAll('[role=option]')];
   const observer=new MutationObserver(()=>{});observer.observe(root,{subtree:true,attributes:true,attributeFilter:['class','aria-selected']});
   const times=[];for(let i=0;i<40;i++){const start=performance.now();button.dispatchEvent(new KeyboardEvent('keydown',{key:i<20?'ArrowDown':'ArrowUp',bubbles:true,cancelable:true}));times.push(performance.now()-start);}
   const mutations=observer.takeRecords().length;observer.disconnect();const focused=root.querySelector('.focused');
   return{options:rows.length,steps:40,mutations,totalMs:times.reduce((a,b)=>a+b,0),maxMs:Math.max(...times),focused:root.querySelectorAll('.focused').length,activeId:button.getAttribute('aria-activedescendant'),focusedId:focused?.id};
  },{control,list});
  const select=await measure('#text-operation','.select-popup');assert.equal(select.focused,1);assert.equal(select.activeId,select.focusedId);await main.keyboard.press('Escape');
  await main.locator('[data-page=settings]').click();await main.locator('[data-settings-tab=appearance]').click();await main.locator('#appearance-font').click();await expect.poll(()=>main.locator('.font-options [role=option]').count()).toBeGreaterThan(4);await expect(main.locator('.font-status')).toBeHidden();
  const fonts=await measure('#appearance-font-search','.font-options');assert.equal(fonts.focused,1);assert.equal(fonts.activeId,fonts.focusedId);
  const result={result:'MEASURED',select,fonts,numberControls,errors};
  if(process.env.ONE_EXPECT_CHOICE_REWRITES!=='1'){
   assert.ok(select.mutations<=select.steps*2,JSON.stringify(select));assert.ok(fonts.mutations<=fonts.steps*2,JSON.stringify(fonts));assert.ok(numberControls.every(input=>input.wrappers===1),JSON.stringify(numberControls));
   const pageScroll=await main.locator('.content').evaluate(node=>node.scrollTop);
   await main.evaluate(()=>{const input=document.querySelector('#appearance-font-search');for(let i=0;i<70;i++)input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));});
   await main.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const fontScroll=await main.evaluate(()=>{const list=document.querySelector('.font-options'),item=list.querySelector('.focused'),box=list.getBoundingClientRect(),row=item.getBoundingClientRect();return{top:row.top-box.top,bottom:box.bottom-row.bottom,scrollTop:list.scrollTop,pageScroll:document.querySelector('.content').scrollTop};});
   assert.ok(fontScroll.top>=-1&&fontScroll.bottom>=-1,JSON.stringify(fontScroll));assert.equal(fontScroll.pageScroll,pageScroll);assert.ok(fontScroll.scrollTop>0);result.fontListScrollsWithoutPage=fontScroll;
   await main.keyboard.press('Escape');await main.locator('[data-page=text]').click();
   await main.evaluate(()=>document.querySelector('#text-operation').dispatchEvent(new CustomEvent('one:options',{detail:[{label:'不可用首项',value:'off-start',disabled:true},{label:'可用一',value:'first'},{label:'不可用中项',value:'off-middle',disabled:true},{label:'可用二',value:'second'},{label:'不可用末项',value:'off-end',disabled:true}]})));
   await main.locator('#text-operation').click();await expect(main.locator('.select-popup .focused')).toHaveText('可用一');await main.keyboard.press('ArrowDown');await expect(main.locator('.select-popup .focused')).toHaveText('可用二');await main.keyboard.press('ArrowDown');await expect(main.locator('.select-popup .focused')).toHaveText('可用二');await main.keyboard.press('Home');await expect(main.locator('.select-popup .focused')).toHaveText('可用一');await main.keyboard.press('End');await expect(main.locator('.select-popup .focused')).toHaveText('可用二');
   await main.evaluate(()=>document.querySelector('#text-operation').value='first');await expect(main.locator('.select-popup [aria-selected=true]')).toHaveText('可用一');await main.keyboard.press('Enter');await expect(main.locator('.select-popup')).toHaveCount(0);await expect(main.locator('#text-operation')).toContainText('可用二');
   await main.evaluate(()=>document.querySelector('#text-operation').dispatchEvent(new CustomEvent('one:options',{detail:[{label:'全部不可用',value:'off',disabled:true}]})));await main.locator('#text-operation').click();await main.keyboard.press('ArrowDown');await main.keyboard.press('Enter');await expect(main.locator('.select-popup .focused')).toHaveCount(0);await expect(main.locator('#text-operation')).not.toHaveAttribute('aria-activedescendant',/.+/);await main.keyboard.press('Escape');
   await main.evaluate(()=>document.querySelector('#text-operation').dispatchEvent(new CustomEvent('one:options',{detail:[]})));await main.locator('#text-operation').click();await expect(main.locator('.select-empty')).toHaveText('没有可选项');await main.keyboard.press('Enter');await expect(main.locator('.select-popup .focused')).toHaveCount(0);assert.equal(await main.locator('#text-operation').evaluate(button=>button.value),'');await main.keyboard.press('Escape');
   await main.emulateMedia({reducedMotion:'reduce'});await main.locator('#text-operation').click();assert.equal(await main.locator('.select-popup').evaluate(popup=>getComputedStyle(popup).animationName),'none');await main.keyboard.press('Escape');
   assert.deepEqual(errors,[]);Object.assign(result,{result:'PASS',disabledItemsSkipped:true,selectionUpdatesWhileOpen:true,emptyAndAllDisabledSafe:true,reducedMotion:true});
  }
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
