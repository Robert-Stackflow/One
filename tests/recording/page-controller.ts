import {recordingPage,recordingHeadingActions,setupRecording} from '../../src/renderer/recording-view';
import {selectSource} from '../../src/renderer/controls';
import {setupSegments} from '../../src/renderer/segments';
import type {RecorderAPI,RecordingState,RecordingOptions,AudioTestState} from '../../src/shared/recording/recording';
import '../../src/renderer/styles.css';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
setupSegments(document.getElementById('app'));
function check(value:unknown,message:string){if(!value)throw Error(message);}
async function until(predicate:()=>boolean,message:string){const end=Date.now()+6000;while(!predicate()){if(Date.now()>end)throw Error('Timeout: '+message);await delay(20);}}
const subscriptions={change:new Set<()=>void>(),stop:new Set<()=>void>(),start:new Set<()=>void>(),audio:new Set<(value:AudioTestState)=>void>()};
function subscribe<T extends (...args:any[])=>void>(set:Set<T>,callback:T){set.add(callback);return()=>set.delete(callback);}
let state:RecordingState={phase:'idle',token:'',seconds:0,bytes:0,dark:false,message:''};
const counts={arm:0,native:0,finish:0,cancel:0,source:0,heartbeat:0,audioStarts:0,audioStops:0};
const audioActive=new Set<string>(),cameraRequests:(string|null)[]=[],activeRequests:boolean[]=[];
const parts:Uint8Array[]=[];
let cameraGate:Promise<void>|undefined,armGate:Promise<void>|undefined;
const emit=()=>{for(const callback of subscriptions.change)callback();};
const api:RecorderAPI={
  pageActive:async value=>{activeRequests.push(value);},
  state:async()=>({...state}),
  audioTest:async(channel,enabled)=>{counts[enabled?'audioStarts':'audioStops']++;if(enabled)audioActive.add(channel);else audioActive.delete(channel);for(const callback of subscriptions.audio)callback({channel,status:enabled?'active':'idle',level:enabled?0.3:0});},
  onAudioTest:callback=>subscribe(subscriptions.audio,callback),
  onChange:callback=>subscribe(subscriptions.change,callback),
  onStart:callback=>subscribe(subscriptions.start,callback),
  onStop:callback=>subscribe(subscriptions.stop,callback),
  sources:async(type='screen')=>{counts.source++;return[{id:type==='screen'?'screen:1:0':'window:123:0',type,name:type==='screen'?'测试显示器':'测试窗口',thumbnail:'',display_id:type==='screen'?'1':''}];},
  audioDevices:async()=>({devices:[{id:'system-test',name:'测试系统声音',kind:'system'},{id:'mic-test',name:'测试麦克风',kind:'microphone'}],bitrates:[128000],rate:48000,channels:2}),
  cameras:async()=>{await cameraGate;return[{id:'camera-test',name:'测试摄像头'}];},
  cameraSetup:async device=>{cameraRequests.push(device);return null;},
  nativeStart:async options=>{counts.native++;state={...state,phase:'recording',backend:'wgc',token:'native-'+counts.native,options};emit();},
  nativePause:async(_token,paused)=>{state.phase=paused?'paused':'recording';emit();},
  nativeGain:async()=>{},nativeStop:async()=>{state.phase='ready';emit();},
  arm:async(options:RecordingOptions)=>{counts.arm++;await armGate;parts.length=0;state={...state,backend:undefined,phase:'arming',token:'webm-'+counts.arm,options,bytes:0,seconds:0};return state.token;},
  started:async(token,mime)=>{check(token===state.token,'Wrong start token');state.phase='recording';state.mime=mime;emit();},
  chunk:async(token,sequence,data)=>{check(token===state.token,'Wrong chunk token');check(sequence===parts.length,'Chunk order changed');parts.push(new Uint8Array(data));state.bytes+=data.byteLength;await delay(5);},
  heartbeat:async(token,seconds)=>{check(token===state.token,'Wrong heartbeat token');counts.heartbeat++;state.seconds=seconds;},
  paused:async(_token,paused)=>{state.phase=paused?'paused':'recording';emit();},
  finish:async(token,seconds,_reason,mime)=>{check(token===state.token,'Wrong finish token');check(parts.length>0,'Final media missing');state={...state,phase:'ready',seconds,mime};counts.finish++;emit();},
  cancel:async()=>{counts.cancel++;state.phase='idle';emit();},fail:async(_token,message)=>{throw Error('Unexpected capture failure: '+message);},
  startAvailability:async()=>{},prepareNext:async()=>{state.phase='idle';},
  beginMicrophoneList:async()=>'devices',endMicrophoneList:async()=>{},
  openMaterials:async()=>{},openProject:async()=>{},openPlayer:async()=>{},importVideo:async()=>{},cancelImport:async()=>{},
  chooseRegion:async()=>({token:'region',width:160,height:120}),
  recoverAudio:async()=>{},discardAudioDraft:async()=>{},
  inputEvents:async()=>[],annotationEvents:async()=>[],cameraLayouts:async()=>[],cursorEvents:async()=>[],cursorShapes:async()=>[],
  save:async()=>null,saveCamera:async()=>null,copySaved:async()=>{},
};
const streams:MediaStream[]=[];
const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
const context=canvas.getContext('2d')!;
let frame=0;
const paint=setInterval(()=>{context.fillStyle=frame++%2?'#529bdc':'#237025';context.fillRect(0,0,320,240);},40);
Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{const stream=canvas.captureStream(15);streams.push(stream);return stream;}});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{throw Error('Real devices must not open in this test');}});

(window as any).runRecordingPageTests=async()=>{
  const root=document.getElementById('page')!,heading=document.getElementById('heading')!;
  const element=(id:string)=>document.getElementById('recording-'+id)!;
  const input=(id:string,value:boolean)=>{const node=element(id) as HTMLInputElement;node.checked=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
  const select=(id:string,value:string)=>{const node=selectSource(element(id))!;node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
  const create=()=>{root.innerHTML=recordingPage();heading.innerHTML=recordingHeadingActions();return setupRecording(root,heading,api);};
  let controller=create();
  try{
    check(subscriptions.change.size===1&&subscriptions.audio.size===1,'Subscriptions duplicated during setup');
    check(!root.querySelector('iframe,webview'),'Embedded recording content');
    check([...root.querySelectorAll('[id]')].every(node=>node.id.startsWith('recording-')),'Unscoped recording IDs');
    await controller.activate(true);
    await until(()=>!(element('start') as HTMLButtonElement).disabled,'initial sources');
    check(counts.source===1,'First activation fetched sources more than once');
    check(root.querySelector('.display-preview')!.getBoundingClientRect().height>100,'Shared source card preview collapsed');
    check(getComputedStyle(element('choose-region-options')).display==='none','Closed region menu is visible');
    check(document.documentElement.dataset.theme==='dark','Recording page replaced One theme');
    check(document.getElementById('start')!.textContent==='Outside','Recording controller queried another page');
    const basic=root.querySelector<HTMLButtonElement>('[data-config-tab=basic]')!;
    basic.focus();basic.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    const quality=root.querySelector<HTMLButtonElement>('[data-config-tab=quality]')!;
    check(!element('config-quality').hidden&&element('config-basic').hidden,'One config tabs failed');
    check(quality.classList.contains('selected'),'One selected segment state missing');
    root.querySelector<HTMLButtonElement>('[data-config-tab=basic]')!.click();
    check(element('record-container').getAttribute('role')==='combobox','One select not applied');
    check(!!root.querySelector('.color-picker-control'),'One color control not applied');
    element('record-audio').click();
    check(element('record-config-tabs').hidden&&!element('config-basic').hidden,'Audio mode should expose one settings form');
    check(element('quality-settings').closest('.record-output-card')!==null,'Audio quality should remain with output settings');
    select('record-container','wav');
    check(!element('quality-empty').hidden&&element('audio-bitrate-field').hidden,'WAV should explain its uncompressed quality');
    element('screens').click();
    check(!element('record-config-tabs').hidden&&element('quality-settings').parentElement===element('config-quality'),'Video mode should restore quality tab');
    check((element('record-container') as HTMLSelectElement).value==='mp4','Audio format leaked into video mode');
    root.style.width='610px';controller.scale(150);await delay(40);
    check(getComputedStyle(root.querySelector('.record-setup-scroll')!).display==='block','Narrow One page did not switch layout');
    check(root.scrollWidth<=root.clientWidth+1,'Scaled recording page overflows horizontally');
    root.style.width='';controller.scale(100);await delay(20);
    input('system-audio',true);
    await delay(20);
    element('system-sound-source').querySelector<HTMLButtonElement>('.audio-test-button')!.click();
    await until(()=>audioActive.size===1,'audio test start');
    await controller.activate(false);
    check(audioActive.size===0,'Hidden page kept audio endpoint open');
    check(activeRequests.at(-1)===false,'Host did not receive page deactivation');
    const starts=counts.arm+counts.native;
    for(const callback of subscriptions.start)callback();
    await delay(30);check(counts.arm+counts.native===starts,'Hidden page started capture');
    await controller.activate(true);
    check(subscriptions.change.size===1&&subscriptions.start.size===1,'Reactivation added subscriptions');
    let releaseCamera!:()=>void;cameraGate=new Promise(resolve=>{releaseCamera=resolve;});
    element('camera-source').click();await delay(10);
    await controller.activate(false);const cameraCount=cameraRequests.filter(Boolean).length;
    releaseCamera();cameraGate=undefined;await delay(30);
    check(cameraRequests.filter(Boolean).length===cameraCount,'Late device result reopened preview');
    await controller.activate(true);await until(()=>cameraRequests.includes('camera-test'),'camera setup preview');
    element('screens').click();await delay(20);
    select('record-container','webm');input('system-audio',false);input('microphone',false);
    await until(()=>!(element('start') as HTMLButtonElement).disabled,'WebM start available');
    element('start').click();for(const callback of subscriptions.start)callback();
    await until(()=>state.phase==='recording','WebM recording');
    check(counts.arm===1,'Header and start event created duplicate captures');
    await until(()=>parts.length>=1,'first actual MediaRecorder chunk');
    const before=parts.length,token=state.token;
    await controller.activate(false);root.hidden=true;
    await until(()=>parts.length>before,'hidden page media chunk');
    check(state.token===token&&state.phase==='recording','Switching pages changed capture');
    check(streams.at(-1)!.getVideoTracks()[0].readyState==='live','Switching pages ended media track');
    root.hidden=false;await controller.activate(true);
    check(counts.arm===1,'Returning to page restarted capture');
    element('pause').click();await until(()=>state.phase==='paused','pause');
    element('pause').click();await until(()=>state.phase==='recording','resume');
    element('stop').click();await until(()=>counts.finish===1,'final WebM data drain');
    check(streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')),'Stopped stream leaked');
    await controller.dispose();
    check(Object.values(subscriptions).every(set=>set.size===0),'Disposed subscriptions leaked');
    controller=create();await controller.activate(true);
    select('record-container','webm');input('system-audio',false);input('microphone',false);
    await controller.start();await until(()=>state.phase==='recording','second WebM');
    await delay(100);await controller.dispose();
    check(counts.finish===2,'Disposal did not finish active WebM');
    check(streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')),'Disposal leaked a media track');
    controller=create();await controller.activate(true);
    select('record-container','webm');input('system-audio',false);input('microphone',false);
    let releaseArm!:()=>void;armGate=new Promise(resolve=>{releaseArm=resolve;});
    const starting=controller.start();await until(()=>counts.arm===3,'pending arm');
    let disposed=false;const disposing=controller.dispose().then(()=>{disposed=true;});
    await delay(20);check(!disposed,'Disposal abandoned an outstanding arm request');
    releaseArm();armGate=undefined;await Promise.all([starting,disposing]);
    check(state.phase==='idle','A late arm survived controller disposal');
    check(counts.finish===2,'Cancelled startup produced a recording');
    controller=create();state={...state,phase:'idle',backend:undefined};await controller.activate(true);
    await controller.start();await until(()=>state.backend==='wgc','native start');
    await controller.activate(false);check(state.phase==='recording','Native recording stopped on page switch');
    await controller.dispose();check(state.phase==='ready','Disposal did not stop native recording');
    check(Object.values(subscriptions).every(set=>set.size===0),'Final listener leak');
    return {result:'PASS',webmAttempts:counts.arm,completedWebm:counts.finish,nativeCaptures:counts.native,heartbeat:counts.heartbeat,hiddenPageChunks:true,idleDeviceRelease:true,latePreviewRejected:true,pendingArmCancelled:true,listeners:0,themePreserved:true,oneControls:true,narrow150:true};
  }finally{await controller.dispose();clearInterval(paint);streams.forEach(stream=>stream.getTracks().forEach(track=>track.stop()));}
};
(window as any).previewRecordingPage=async()=>{
  state={phase:'idle',token:'',seconds:0,bytes:0,dark:false,message:''};
  const root=document.getElementById('page')!,heading=document.getElementById('heading')!;
  document.getElementById('start')!.remove();
  document.documentElement.style.setProperty('--surface','var(--dark-surface)');
  document.documentElement.style.setProperty('--fg','var(--dark-fg)');
  document.documentElement.style.setProperty('--accent','var(--dark-accent)');
  document.documentElement.style.setProperty('--on-accent','var(--dark-on-accent)');
  heading.style.cssText='display:flex;justify-content:flex-end;padding:16px 24px';
  root.style.padding='0 24px';
  root.style.width='';root.innerHTML=recordingPage();heading.innerHTML=recordingHeadingActions();
  const controller=setupRecording(root,heading,api);await controller.activate(true);
  await until(()=>!(document.getElementById('recording-start') as HTMLButtonElement).disabled,'preview ready');await delay(120);
  (window as any).disposeRecordingPreview=()=>controller.dispose();
};
