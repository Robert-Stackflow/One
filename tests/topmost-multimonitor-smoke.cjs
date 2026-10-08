const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const koffi=require('koffi');

const user=koffi.load('user32.dll');
const dwm=koffi.load('dwmapi.dll');
const enumerate=user.func('bool __stdcall EnumWindows(void *cb,intptr_t value)');
const getClass=user.func('int __stdcall GetClassNameW(uintptr_t hwnd,void *text,int count)');
const getRect=user.func('bool __stdcall GetWindowRect(uintptr_t hwnd,void *rect)');
const visible=user.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)');
const nextWindow=user.func('uintptr_t __stdcall GetWindow(uintptr_t hwnd,uint32 command)');
const style=user.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd,int index)');
const extended=dwm.func('int32 __stdcall DwmGetWindowAttribute(uintptr_t hwnd,uint32 attribute,void *value,uint32 size)');
const proto=koffi.proto('bool __stdcall OneBorderProbe(uintptr_t hwnd,intptr_t value)');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rect=buffer=>Array.from({length:4},(_,i)=>buffer.readInt32LE(i*4));
function nextVisible(hwnd){for(let next=nextWindow(hwnd,2);next;next=nextWindow(next,2))if(visible(next))return next;return 0;}

function borderWindows(){
 const result=[];
 const cb=koffi.register(hwnd=>{
  const name=Buffer.alloc(128);getClass(hwnd,name,64);
  if(name.toString('utf16le').replace(/\0.*$/s,'')==='OneTopmostBorder'){
   const box=Buffer.alloc(16);getRect(hwnd,box);
   result.push({hwnd,rect:rect(box),visible:visible(hwnd),topmost:!!(Number(style(hwnd,-20))&8)});
  }
  return true;
 },koffi.pointer(proto));
 try{enumerate(cb,0);}finally{koffi.unregister(cb);}
 return result;
}

async function run(){
 const output=path.resolve('work/topmost-multimonitor');await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(output,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.waitForSelector('[data-page=home]');
  const fixture=await app.evaluate(async({BrowserWindow,screen})=>{
   const window=new BrowserWindow({width:560,height:420,title:'One multi-monitor border fixture'});
   await window.loadURL('data:text/html,<title>One multi-monitor border fixture</title>border test');
   return {hwnd:Number(window.getNativeWindowHandle().readBigUInt64LE()),displays:screen.getAllDisplays().map(display=>({id:display.id,bounds:display.bounds,scaleFactor:display.scaleFactor}))};
  });
  if(fixture.displays.length<2){console.log(JSON.stringify({result:'SKIP',reason:'requires two displays'}));return;}
  await page.evaluate(()=>window.one.patchSettings({utilities:{topmost:{enabled:true,shortcut:'',border:true,opacity:90,thickness:6}}}));
  await page.evaluate(hwnd=>window.one.toggleTopmost(hwnd),fixture.hwnd);
  const checks=[];let borderHandle=0;
  for(const [index,display] of [...fixture.displays,...fixture.displays].reverse().entries()){
   await app.evaluate(({BrowserWindow},request)=>{
    const window=BrowserWindow.getAllWindows().find(item=>item.getTitle()==='One multi-monitor border fixture');
    const {bounds,width}=request;window.setBounds({x:Math.round(bounds.x+bounds.width/4),y:Math.round(bounds.y+bounds.height/4),width,height:420});
   },{bounds:display.bounds,width:index%2?480:560});
   await expect.poll(()=>borderWindows().length).toBe(1);
   const target=Buffer.alloc(16),borderPhysical=Buffer.alloc(16),margin=Math.round(6*display.scaleFactor);
   await expect.poll(()=>{
    const border=borderWindows()[0];if(!border)return false;
    if(extended(fixture.hwnd,9,target,16)!==0||extended(border.hwnd,9,borderPhysical,16)!==0)return false;
    const [left,top,right,bottom]=rect(target);
    return rect(borderPhysical).every((value,i)=>Math.abs(value-[left-margin,top-margin,right+margin,bottom+margin][i])<=1);
   }).toBe(true);
   const border=borderWindows()[0];borderHandle ||= border.hwnd;
   assert.equal(border.hwnd,borderHandle,'moving between monitors should keep the border window');
   assert.equal(border.visible,true);
   assert.equal(border.topmost,true,'the border must remain in the topmost z-order band');
   assert.equal(nextVisible(fixture.hwnd),border.hwnd,'the border should be the next visible window below its target');
   checks.push({display:display.id,scale:display.scaleFactor,margin});
  }
  const left=fixture.displays.reduce((a,b)=>a.bounds.x<b.bounds.x?a:b),right=fixture.displays.reduce((a,b)=>a.bounds.x>b.bounds.x?a:b);
  for(let step=0;step<18;step++){
   const x=Math.round(left.bounds.x+left.bounds.width-650+(right.bounds.x-left.bounds.x+150)*step/17);
   await app.evaluate(({BrowserWindow},position)=>BrowserWindow.getAllWindows().find(item=>item.getTitle()==='One multi-monitor border fixture').setBounds({x:position.x,y:120,width:position.width,height:position.height}),{x,width:500+step*8,height:380+step*5});
   await pause(12);
  }
  await expect.poll(()=>{
   const border=borderWindows()[0],target=Buffer.alloc(16),outline=Buffer.alloc(16);
   if(!border||extended(fixture.hwnd,9,target,16)!==0||extended(border.hwnd,9,outline,16)!==0)return false;
   const margin=Math.round(6*right.scaleFactor),[x1,y1,x2,y2]=rect(target);
   return rect(outline).every((value,i)=>Math.abs(value-[x1-margin,y1-margin,x2+margin,y2+margin][i])<=1)&&border.topmost&&border.visible;
  }).toBe(true);
  console.log(JSON.stringify({result:'PASS',crossDisplayChecks:checks.length,rapidMovesAndResizes:18,checks}));
 }finally{await app.close();const resolved=await fs.realpath(profile),parent=await fs.realpath(output);assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
