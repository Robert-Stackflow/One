import {app,nativeImage,screen} from 'electron';
import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {NativeFrameReader} from '../../src/shared/capture/native-frame';
import {ScrollNative,captureMonitorBounds} from '../../src/main/capture/scroll-native';
import {CaptureProbe} from '../../src/main/capture/capture-probe';
import {captureWindowInfo,disableWindowTransitions,flushDesktopComposition} from '../../src/main/capture/native';

const directory=process.env.ONE_ACQUISITION_TEST_DIR!;
app.setPath('userData',join(directory,'profile'));app.setPath('crashDumps',join(directory,'crashes'));
const native=join(process.cwd(),'dist/native'),run=promisify(execFile),failures:string[]=[];
let fixture:ChildProcessWithoutNullStreams|undefined,capture:ScrollNative|undefined,probe:CaptureProbe|undefined;
const timer=setTimeout(()=>{console.error('Native acquisition verification timed out');fixture?.kill();capture?.stop();probe?.close();app.exit(1);},30000);
function frame(bytes:Buffer){const reader=new NativeFrameReader();reader.append(bytes);return reader.finish();}
function pixels(png:Buffer,red:number,green:number,blue:number){const bytes=nativeImage.createFromBuffer(png).toBitmap();let count=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]===blue&&bytes[i+1]===green&&bytes[i+2]===red&&bytes[i+3]===255)count++;return count;}
async function closed(child:ChildProcessWithoutNullStreams,stop:()=>void){if(child.exitCode!==null)return;const done=once(child,'close');stop();await done;}
void app.whenReady().then(async()=>{
  // Decode the actual native encoder output before exercising Windows capture.
  const selfTest=await run(join(native,'One.ScrollCapture.exe'),['--self-test-png'],{windowsHide:true,encoding:'buffer',maxBuffer:4*1024*1024});
  const encoded=frame(selfTest.stdout),bitmap=nativeImage.createFromBuffer(encoded.png).toBitmap();
  assert.equal(encoded.info.width,257);assert.equal(encoded.info.height,83);
  for(const [x,y] of [[0,0],[42,30],[256,82]])assert.deepEqual([...bitmap.subarray((y*257+x)*4,(y*257+x)*4+4)],[x%256,y,(x+y)%256,255]);
  fixture=spawn(join(native,'One.CaptureProbe.exe'),['--fixture'],{windowsHide:true,stdio:'pipe'});
  const lines=createInterface({input:fixture.stdout});
  const [line]=await Promise.race([once(lines,'line'),once(fixture,'error').then(([error])=>{throw error;})]);
  const info=JSON.parse(String(line));lines.close();
  assert.equal(info.pid,fixture.pid);const target=captureWindowInfo(info.hwnd);assert.ok(target);assert.equal(target.pid,info.pid);
  assert.equal(disableWindowTransitions(info.hwnd),true);assert.equal(flushDesktopComposition(),true);
  const monitor=captureMonitorBounds(screen.getDisplayNearestPoint({x:info.window.x,y:info.window.y}));assert.ok(monitor.width>0&&monitor.height>0);
  probe=new CaptureProbe(error=>failures.push(String(error)));
  const point={x:info.edit.x+Math.floor(info.edit.width/2),y:info.edit.y+Math.floor(info.edit.height/2)};
  const candidates=await probe.query(point,()=>{});
  assert.ok(candidates.some((item:any)=>item.kind==='window'));
  assert.ok(candidates.some((item:any)=>item.kind==='element'&&point.x>=item.rect.x&&point.y>=item.rect.y&&point.x<item.rect.x+item.rect.width&&point.y<item.rect.y+item.rect.height));
  const single=await run(join(native,'One.SingleCapture.exe'),['window',String(info.hwnd),String(info.pid),String(process.pid)],{windowsHide:true,encoding:'buffer',maxBuffer:8*1024*1024});
  const first=frame(single.stdout);assert.equal(first.info.width,info.window.width);assert.equal(first.info.height,info.window.height);assert.ok(pixels(first.png,225,35,65)>100);
  await assert.rejects(run(join(native,'One.SingleCapture.exe'),['window',String(info.hwnd),String(info.pid+1),String(process.pid)],{windowsHide:true,encoding:'buffer',maxBuffer:1024}));
  capture=new ScrollNative({hwnd:info.hwnd,pid:info.pid});await capture.ready;
  const initial=await capture.frame();assert.ok(pixels(initial,225,35,65)>100);
  fixture.stdin.write('paint 2\n');let changed=await capture.frame(true),attempts=0;
  while(pixels(changed,35,180,75)<100&&attempts++<8)changed=await capture.frame(true);
  assert.ok(pixels(changed,35,180,75)>100,'Fresh acquisition must include the repainted original pixels');
  assert.equal(pixels(changed,225,35,65),0);
  fixture.stdin.write('cover\n');await new Promise(resolve=>setTimeout(resolve,100));
  const occluded=await capture.frame(true);assert.ok(pixels(occluded,35,180,75)>100,'Window acquisition must keep the target pixels under an occluder');
  const captureChild=(capture as any).child as ChildProcessWithoutNullStreams;await closed(captureChild,()=>capture!.stop());capture=undefined;
  const probeChild=(probe as any).child as ChildProcessWithoutNullStreams;await closed(probeChild,()=>probe!.close());probe=undefined;
  await closed(fixture,()=>fixture!.stdin.write('quit\n'));fixture=undefined;
  assert.deepEqual(failures,[]);
  console.log(JSON.stringify({result:'PASS',transport:true,probe:true,single:true,windowIdentity:true,freshWindowFrames:true,occlusion:true,ownedProcessCleanup:true}));
}).then(()=>{clearTimeout(timer);app.exit(0);},error=>{clearTimeout(timer);console.error(error);capture?.stop();probe?.close();fixture?.kill();app.exit(1);});
