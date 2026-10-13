import {app,BrowserWindow,ipcMain,protocol} from 'electron';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {defaultAppearance} from '../../src/shared/settings';
import type {Appearance} from '../../src/shared/types';
import {defaultCameraStyle} from '../../src/shared/recording/recording-camera';
import {defaultInputStyle} from '../../src/shared/recording/recording-input';
import {defaultAnnotationStyle,type AnnotationPacket} from '../../src/shared/recording/recording-annotations';
import type {ImageDocument} from '../../src/shared/capture/image-document';

const directory=process.env.ONE_RECORDING_TEST_DIRECTORY!,renderer=resolve('dist/renderer');
app.setPath('userData',join(directory,'profile'));app.setPath('crashDumps',join(directory,'crashes'));
app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'one',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const windows:BrowserWindow[]=[],errors:string[]=[],calls:{name:string;args:any[]}[]=[];
const timeout=setTimeout(()=>{console.error('Recording overlay page timeout');app.exit(1);},45000);
const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(window:BrowserWindow,code:string)=>window.webContents.executeJavaScript(code);
async function until(check:()=>Promise<unknown>|unknown,label:string){for(let i=0;i<100;i++){if(await check())return;await pause();}throw Error('Timed out: '+label);}
function handle(name:string,handler:(...args:any[])=>unknown){ipcMain.handle('one:'+name,(_event,...args)=>{calls.push({name,args});return handler(...args);});}
async function open(role:string,width:number,height:number){
  const window=new BrowserWindow({width,height,useContentSize:true,frame:false,transparent:true,show:false,webPreferences:{...(role==='recording-region-outline'?{}:{preload:join(directory,role+'.cjs')}),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  windows.push(window);
  window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(role+': '+event.message);});
  await window.loadURL('one://app/index.html?view='+role);
  await until(()=>js(window,`document.body.dataset.view===${JSON.stringify(role)}&&document.getElementById('app').children.length>0`),role);
  return window;
}
function pointer(window:BrowserWindow,x:number,y:number,type:'mouseDown'|'mouseUp'|'mouseMove'){
  window.webContents.sendInputEvent({type,x,y,button:'left',clickCount:type==='mouseMove'?0:1});
}
async function main(){
  await app.whenReady();
  protocol.handle('one',async request=>{
    const url=new URL(request.url),file=resolve(renderer,'.'+decodeURIComponent(url.pathname));
    if(url.host!=='app'||!file.startsWith(renderer+sep))return new Response(null,{status:404});
    try{return new Response(new Uint8Array(await readFile(file)),{headers:{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
  });
  const appearance:Appearance={...defaultAppearance(),mode:'dark',font:'mono',darkBackground:'#345345'};
  handle('appearance',()=>appearance);handle('ui-font-source',()=>({local:[]}));handle('diagnostics-report',(kind,detail)=>{errors.push(kind+': '+detail);});
  handle('recording-countdown-state',()=>3);handle('recording-countdown-cancel',()=>{});
  handle('recording-region-state',()=>({token:'region',enabled:true,crop:{x:10,y:20,width:640,height:480},message:''}));handle('recording-region-drag',()=>{});
  const input={token:'input',style:{...defaultInputStyle(),keys:'all',clicks:true},width:400,height:240,sample:12000,paused:true,events:[{id:1,sample:0,kind:'key',vk:65,modifiers:2},{id:2,sample:0,kind:'click',x:200,y:90,button:1}]};
  handle('recording-input-state',()=>input);
  let cameraWindow:BrowserWindow;
  const camera={token:'camera',serial:1,url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><path fill="#42a880" d="M0 0h160v120H0z"/><circle fill="#edc569" cx="80" cy="60" r="30"/></svg>'),style:defaultCameraStyle(),width:640,height:480,videoWidth:160,videoHeight:120};
  handle('recording-camera-state',()=>camera);handle('recording-camera-style',(token,style)=>{assert.equal(token,'camera');camera.style=style;if(style.shape==='circle')cameraWindow.setContentSize(234,234);cameraWindow.webContents.send('one:recording-camera-changed',camera);});handle('recording-camera-drag',()=>{});
  const packet:AnnotationPacket={token:'annotation',width:400,height:240,interactive:true,tool:'rectangle',style:defaultAnnotationStyle()};let scene:ImageDocument|undefined;
  handle('recording-annotation-state',()=>packet);handle('recording-annotation-scene',(token,value)=>{assert.equal(token,'annotation');scene=value;});handle('recording-annotation-selected',()=>{});handle('recording-annotation-flushed',()=>{});
  handle('recording-annotation-frame',()=>({width:2,height:2,pixels:new Uint8Array(16)}));

  const countdown=await open('recording-countdown',400,400);
  await until(()=>js(countdown,"document.getElementById('seconds').textContent==='3'"),'countdown initial');
  const geometry=await js(countdown,"(()=>{const r=document.querySelector('.count').getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,viewport:innerWidth};})()");
  assert.equal(geometry.width,160);assert.equal(geometry.height,160);assert.ok(Math.abs(geometry.x+80-geometry.viewport/2)<1);
  countdown.webContents.send('one:recording-countdown-tick',1);await until(()=>js(countdown,"document.getElementById('seconds').textContent==='1'"),'countdown tick');
  await js(countdown,"document.getElementById('cancel').click();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  await until(()=>calls.filter(c=>c.name==='recording-countdown-cancel').length===2,'countdown cancel');

  const region=await open('recording-region-overlay',210,36);
  await until(()=>js(region,"document.getElementById('size').textContent==='640 × 480 px'"),'region dimensions');
  assert.equal(await js(region,"getComputedStyle(document.getElementById('drag')).backgroundColor"),'rgb(52, 83, 69)');
  assert.equal(await js(region,"document.getElementById('frame').hidden"),true);
  pointer(region,50,18,'mouseDown');pointer(region,75,18,'mouseMove');pointer(region,75,18,'mouseUp');
  await until(()=>calls.some(c=>c.name==='recording-region-drag'&&c.args[1]==='end'),'region pointer release');
  const outline=await open('recording-region-outline',210,140);
  assert.equal(await js(outline,"typeof window.one"),'undefined');
  assert.deepEqual(await js(outline,"[document.getElementById('drag').hidden,document.getElementById('frame').hidden,getComputedStyle(document.body).backgroundColor]"),[true,false,'rgba(0, 0, 0, 0)']);

  const inputWindow=await open('recording-input-overlay',400,240);
  const canvasPixels="(()=>{const c=document.querySelector('canvas');return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).filter((v,i)=>i%4===3&&v>0).length;})()";
  await until(async()=>await js(inputWindow,canvasPixels)>100,'input canvas');
  inputWindow.webContents.send('one:recording-input-changed',{...input,events:[]});
  await until(async()=>await js(inputWindow,canvasPixels)===0,'input event replacement');
  inputWindow.webContents.send('one:recording-input-changed',input);

  cameraWindow=await open('recording-camera-overlay',280,210);
  await until(async()=>await js(cameraWindow,canvasPixels)>1000,'camera canvas');
  const originalMirror=camera.style.mirror;await js(cameraWindow,"document.getElementById('mirror').click()");await until(()=>camera.style.mirror!==originalMirror,'camera mirror');
  await js(cameraWindow,"document.getElementById('shape').click()");await until(()=>camera.style.shape==='circle','camera shape');await until(()=>js(cameraWindow,'Math.abs(innerWidth-innerHeight)<=1&&document.querySelector("canvas").width===Math.round(innerWidth*devicePixelRatio)'),'camera square layout').catch(async error=>{throw Error(error.message+' '+JSON.stringify({native:cameraWindow.getContentSize(),page:await js(cameraWindow,'[innerWidth,innerHeight,devicePixelRatio,document.querySelector("canvas").width,document.querySelector("canvas").height]')}));});
  pointer(cameraWindow,70,90,'mouseDown');pointer(cameraWindow,90,105,'mouseMove');pointer(cameraWindow,90,105,'mouseUp');
  await until(()=>calls.some(c=>c.name==='recording-camera-drag'&&c.args[1]==='end'&&c.args[2]===false),'camera move');

  const annotation=await open('recording-annotation-overlay',400,240);
  await until(()=>js(annotation,"document.documentElement.dataset.interactive==='true'"),'annotation initialized');
  pointer(annotation,45,40,'mouseDown');pointer(annotation,170,130,'mouseMove');pointer(annotation,170,130,'mouseUp');
  await until(()=>scene?.annotations.length===1,'annotation rectangle');
  assert.equal(scene!.annotations[0].tool,'rectangle');
  annotation.webContents.send('one:recording-annotation-changed',{...packet,flush:'fixture-flush'});
  await until(()=>calls.some(c=>c.name==='recording-annotation-flushed'&&c.args[1]==='fixture-flush'&&c.args[2]===''),'annotation flush');
  await until(async()=>await js(annotation,canvasPixels)>100,'annotation canvas');
  const fonts=await js(cameraWindow,"[getComputedStyle(document.body).fontFamily,getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim()]");assert.ok(fonts[1]);assert.equal(fonts[0].replace(/['"\s]/g,''),fonts[1].replace(/['"\s]/g,''));
  for(const window of windows)assert.equal(await js(window,'document.documentElement.scrollWidth>innerWidth'),false);
  for(const [name,window] of [['countdown',countdown],['region',region],['outline',outline],['input',inputWindow],['camera',cameraWindow],['annotation',annotation]] as const){
    const image=await window.webContents.capturePage();await writeFile(join(directory,name+'.png'),image.toPNG());
  }
  await pause();assert.deepEqual(errors,[]);
  const photos=['countdown','region','outline','input','camera','annotation'];
  for(const name of photos)await writeFile(join(process.env.ONE_RECORDING_EVIDENCE!,name+'.png'),await readFile(join(directory,name+'.png')));
  for(const window of windows)window.destroy();assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({result:'PASS',productionRenderer:true,productionPreloads:true,windows:windows.length,oneTheme:true,countdownCancel:true,regionDrag:true,outlineNoAPI:true,inputCanvas:true,cameraActions:true,annotationSceneAndFlush:true,remainingWindows:0}));
}
main().then(()=>{clearTimeout(timeout);app.exit(0);}).catch(error=>{console.error(error.stack||String(error));if(errors.length)console.error(JSON.stringify(errors).slice(0,5000));for(const window of windows)if(!window.isDestroyed())window.destroy();clearTimeout(timeout);app.exit(1);});
