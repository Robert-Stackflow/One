import test from 'node:test';
import assert from 'node:assert/strict';
import {ScrollStitch} from '../../src/shared/capture/scroll-stitch';
import {ScrollSettle} from '../../src/shared/capture/scroll-settle';
import {scrollDefaults} from '../../src/shared/capture/scroll-capture';
import {NativePixelReader,FRAME_PIXEL_LIMIT} from '../../src/shared/capture/native-pixels';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {ScrollMotion} from '../../src/shared/capture/scroll-motion';
import {scrollSearchCandidates} from '../../src/shared/capture/scroll-search';
import sharp from 'sharp';
import {createScrollDirectory,cleanScrollDirectory,ScrollDiskStorage,sweepScrollDirectories} from '../../src/main/capture/scroll-storage';
import {readFile,writeFile,unlink,readdir,lstat,mkdtemp,rmdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {detectScrollFixedEdges} from '../../src/shared/capture/scroll-fixed';

test('automatic fixed edges are retained once in exact vertical and horizontal output and undo',()=>{
  for(const axis of ['vertical','horizontal'] as const){
    const vertical=axis==='vertical',width=vertical?96:160,height=vertical?160:96,frame=(offset:number)=>{const result=scrollPixels(width,height,vertical?0:offset,vertical?offset:0);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const row=vertical?y:x;if(row<20||row>=148)result.pixels.set([160,160,160,255],(y*width+x)*4);}return result;};
    const engine=new ScrollStitch(undefined,true);engine.configure({...scrollDefaults(),axis},{width,height});engine.sample(frame(0));assert.equal(engine.sample(frame(39)).match,'accepted');assert.deepEqual(engine.status().fixed,{start:20,end:12});engine.sample(frame(78));assert.equal(vertical?engine.status().height:engine.status().width,238);
    const output=engine.output(),body=scrollPixels(vertical?96:206,vertical?206:96,vertical?0:20,vertical?20:0);const expected=new Uint8Array(output.pixels.length);
    for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){const row=vertical?y:x,at=(y*output.width+x)*4;if(row<20||row>=226)expected.set([160,160,160,255],at);else{const from=vertical?((y-20)*96+x)*4:(y*206+x-20)*4;expected.set(body.pixels.subarray(from,from+4),at);}}
    assert.deepEqual(output.pixels,expected);engine.undo();assert.equal(vertical?engine.status().height:engine.status().width,199);engine.undo();assert.deepEqual(engine.output(),frame(0));
  }
});
test('ordinary blank margins and ambiguous movement do not become automatically removed edges',()=>{
  const width=96,height=160,a=scrollPixels(width,height),b=scrollPixels(width,height,0,39);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;a.pixels[at]=a.pixels[at+1]=a.pixels[at+2]=255;b.pixels[at]=b.pixels[at+1]=b.pixels[at+2]=255;}
  assert.equal(detectScrollFixedEdges(a.pixels,b.pixels,height,width,0,width),undefined);
});

test('localized repeated animation settles and matches on both axes without modifying captured pixels',()=>{
  for(const axis of ['vertical','horizontal'] as const){
    const vertical=axis==='vertical',width=vertical?96:160,height=vertical?160:96,frame=(offset:number,color:number)=>{
      const result=scrollPixels(width,height,vertical?0:offset,vertical?offset:0);
      for(let row=60;row<78;row++)for(let x=30;x<44;x++){const at=(vertical?row*width+x:x*width+row)*4;result.pixels.set([color,255-color,color,255],at);}
      return result;
    },settle=new ScrollSettle({...scrollDefaults(),axis},{width,height}),engine=new ScrollStitch();
    engine.configure({...scrollDefaults(),axis},{width,height});
    const collect=(offset:number,time:number)=>{
      settle.reset();const colors=[20,100,200,40];let last=frame(offset,20);
      for(let i=0;i<colors.length;i++){last=frame(offset,colors[i]);assert.equal(settle.observe(last,time+i*140),i===3);}
      const regions=settle.dynamicRegions();assert.equal(regions.length,1);assert.ok(regions[0].width*regions[0].height<=width*height*.08);return {last,regions};
    };
    const first=collect(0,0);engine.sample(first.last,first.regions);assert.deepEqual(engine.output(),first.last);
    const next=collect(39,1000);assert.equal(engine.sample(next.last,next.regions).match,'accepted');assert.equal(vertical?engine.status().height:engine.status().width,199);
    const output=engine.output();for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,to=(y*output.width+x)*4;assert.deepEqual(output.pixels.subarray(to,to+4),first.last.pixels.subarray(at,at+4));}
    const before=engine.output(),unchanged=collect(39,2000);assert.equal(engine.sample(unchanged.last,unchanged.regions).match,'unchanged');assert.deepEqual(engine.output(),before);engine.undo();assert.deepEqual(engine.output(),first.last);
    assert.throws(()=>engine.sample(next.last,[{x:0,y:0,width,height}]),/动态区域/);assert.deepEqual(engine.output(),first.last);
  }
});

test('one-time local updates settle normally; large or widespread movement is never hidden as animation',()=>{
  const width=96,height=160,local=(color:number)=>{const frame=scrollPixels(width,height);for(let y=60;y<78;y++)for(let x=30;x<44;x++)frame.pixels.set([color,color,color,255],(y*width+x)*4);return frame;};
  const once=new ScrollSettle(scrollDefaults(),{width,height});assert.equal(once.observe(local(0),0),false);assert.equal(once.observe(local(255),140),false);assert.equal(once.observe(local(255),280),false);assert.equal(once.observe(local(255),420),false);assert.equal(once.observe(local(255),560),true);assert.deepEqual(once.dynamicRegions(),[]);
  for(const broad of [false,true]){const settle=new ScrollSettle(scrollDefaults(),{width,height});for(let i=0;i<8;i++){const frame=scrollPixels(width,height,0,broad?i*5:0);if(!broad)for(let y=40;y<100;y++)for(let x=20;x<60;x++)frame.pixels.fill(i*25,(y*width+x)*4,(y*width+x)*4+3);assert.equal(settle.observe(frame,i*140),false);assert.deepEqual(settle.dynamicRegions(),[]);}}
});

test('animation masks cannot manufacture a unique overlap on blank or unrelated bodies',()=>{
  const width=96,height=160,regions=[{x:30,y:60,width:14,height:18}];
  for(const blank of [true,false]){
    const first=scrollPixels(width,height),next=scrollPixels(width,height,511,777);
    if(blank){first.pixels.fill(255);next.pixels.fill(255);}
    for(let y=60;y<78;y++)for(let x=30;x<44;x++){first.pixels.set([0,0,0,255],(y*width+x)*4);next.pixels.set([200,200,200,255],(y*width+x)*4);}
    const engine=new ScrollStitch();engine.configure(scrollDefaults(),{width,height});engine.sample(first,regions);
    assert.equal(engine.sample(next,regions).match,'ambiguous');assert.deepEqual(engine.output(),first);
  }
});

test('detected and manually corrected fixed edges do not delay otherwise quiet frames',()=>{
  for(const axis of ['vertical','horizontal'] as const){
    const vertical=axis==='vertical',width=vertical?96:160,height=vertical?160:96,frame=(color:number)=>{
      const result=scrollPixels(width,height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const row=vertical?y:x;if(row<20||row>=148)result.pixels.set([color,color,color,255],(y*width+x)*4);}
      return result;
    };
    const options={...scrollDefaults(),axis},plain=new ScrollSettle(options,{width,height});
    const detected=new ScrollSettle(options,{width,height});detected.excludeFixed(20,12);
    const manual=new ScrollSettle({...options,retainStart:20,retainEnd:12},{width,height});
    for(const item of [detected,manual]){assert.equal(item.observe(frame(20),0),false);assert.equal(item.observe(frame(100),150),false);assert.equal(item.observe(frame(200),300),true);item.excludeFixed(18,10);assert.equal(item.observe(frame(20),310),false);assert.equal(item.observe(frame(100),460),false);assert.equal(item.observe(frame(200),610),false);}
    plain.observe(frame(20),0);plain.observe(frame(100),150);assert.equal(plain.observe(frame(200),300),false);
  }
});

test('disk-backed automatic edges preserve original strips, preview rows and undo on both axes',async()=>{
  for(const axis of ['vertical','horizontal'] as const){
    const lease=await createScrollDirectory(process.env.ONE_SCROLL_TEST_ROOT!),disk=new ScrollDiskStorage(lease.directory,lease.token);
    try{
      const vertical=axis==='vertical',width=vertical?96:160,height=vertical?160:96,frame=(offset:number)=>{
        const result=scrollPixels(width,height,vertical?0:offset,vertical?offset:0);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){const row=vertical?y:x;if(row<20||row>=148)result.pixels.set([160,160,160,255],(y*width+x)*4);}
        return result;
      },engine=new ScrollStitch(disk,true),memory=new ScrollStitch(undefined,true);
      for(const item of [engine,memory]){item.configure({...scrollDefaults(),axis},{width,height});item.sample(frame(0));item.sample(frame(39));}
      assert.deepEqual(engine.status().fixed,{start:20,end:12});
      assert.equal(engine.storageStats().residentBytes,(128*2+32)*96*4);
      assert.deepEqual(engine.output(),memory.output());assert.deepEqual(engine.preview(),memory.preview());
      engine.undo();memory.undo();assert.deepEqual(engine.output(),frame(0));assert.deepEqual(engine.preview(),memory.preview());
      engine.configure({...scrollDefaults(),axis,autoFixed:false},{width,height});assert.equal(disk.bytes,0);engine.sample(frame(0));
      assert.equal(engine.sample(frame(39)).fixed,undefined);assert.deepEqual(engine.output(),frame(0));
      engine.configure({...scrollDefaults(),axis,autoFixed:false,trimStart:4,trimEnd:4,retainStart:16,retainEnd:8},{width,height});
      engine.sample(frame(0));assert.deepEqual(engine.status().fixed,{start:16,end:8});assert.equal(engine.sample(frame(39)).match,'accepted');memory.sample(frame(39));
      const full=memory.output(),output=engine.output(),cropped=new Uint8Array(output.pixels.length);
      assert.equal(vertical?output.height:output.width,191);
      for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){const from=((y+(vertical?4:0))*full.width+x+(vertical?0:4))*4;cropped.set(full.pixels.subarray(from,from+4),(y*output.width+x)*4);}
      assert.deepEqual(output.pixels,cropped);
      assert.throws(()=>engine.configure({...scrollDefaults(),axis,retainStart:-1},{width,height}),/固定栏/);
      assert.throws(()=>engine.configure({...scrollDefaults(),axis,trimStart:50,retainEnd:50},{width,height}),/64/);
    }finally{disk.reset();await cleanScrollDirectory(lease);}
  }
});

test('cache sweep reclaims an abruptly killed owner and preserves live, foreign and unmarked directories',async()=>{
  const base=await mkdtemp(join(process.env.ONE_SCROLL_TEST_ROOT!,'crash-cases-'));let child:ReturnType<typeof spawn>|undefined,crashed:Awaited<ReturnType<typeof createScrollDirectory>>|undefined;
  const alive=await createScrollDirectory(base),foreign=await createScrollDirectory(base),legacy=await createScrollDirectory(base);const marker=await readFile(join(foreign.directory,'owner.json'));const old=await readFile(join(legacy.directory,'owner.json'));
  try{
    child=spawn(process.execPath,[join(__dirname,'scroll-crash-child.cjs'),base],{windowsHide:true,stdio:['ignore','pipe','pipe']});const lines=createInterface({input:child.stdout!});crashed=JSON.parse(String((await once(lines,'line'))[0]));lines.close();
    await writeFile(join(foreign.directory,'owner.json'),JSON.stringify({...JSON.parse(marker.toString()),pid:2147483647}));await writeFile(join(foreign.directory,'foreign.txt'),'keep');await writeFile(join(legacy.directory,'owner.json'),JSON.stringify({token:legacy.token,pid:2147483647}));
    const initial=await sweepScrollDirectories(base);assert.equal(initial.removed,0);assert.ok((await lstat(crashed!.directory)).isDirectory());
    const ended=once(child,'exit');child.kill();await ended;child=undefined;const result=await sweepScrollDirectories(base);assert.equal(result.removed,1);await assert.rejects(lstat(crashed!.directory),{code:'ENOENT'});assert.ok((await lstat(alive.directory)).isDirectory());assert.equal(await readFile(join(foreign.directory,'foreign.txt'),'utf8'),'keep');assert.ok((await lstat(legacy.directory)).isDirectory());
  }finally{
    if(child){const ended=once(child,'exit');child.kill();await ended;}if(crashed)await cleanScrollDirectory(crashed);
    await unlink(join(foreign.directory,'foreign.txt')).catch(()=>{});await writeFile(join(foreign.directory,'owner.json'),marker);await writeFile(join(legacy.directory,'owner.json'),old);
    await cleanScrollDirectory(alive);await cleanScrollDirectory(foreign);await cleanScrollDirectory(legacy);await rmdir(base);
  }
});

test('disk strips retain exact output, row previews and undo without keeping accumulated pixels in memory',async()=>{
  for(const axis of ['vertical','horizontal'] as const){
    const lease=await createScrollDirectory(process.env.ONE_SCROLL_TEST_ROOT!);try{
      const disk=new ScrollDiskStorage(lease.directory,lease.token),engine=new ScrollStitch(disk),memory=new ScrollStitch(),vertical=axis==='vertical';
      const source={width:vertical?64:160,height:vertical?160:64};engine.configure({...scrollDefaults(),axis},source);memory.configure({...scrollDefaults(),axis},source);
      for(let offset=0;offset<=2400;offset+=24){const frame=scrollPixels(source.width,source.height,vertical?0:offset,vertical?offset:0);engine.sample(frame);memory.sample(frame);}
      assert.deepEqual(engine.output(),memory.output());assert.deepEqual(engine.preview(),memory.preview());const stats=engine.storageStats();assert.ok(stats.diskBytes>stats.residentBytes);assert.equal(stats.diskBytes,64*2560*4);
      const old=disk.bytes;engine.undo();memory.undo();assert.ok(disk.bytes<old);assert.deepEqual(engine.output(),memory.output());engine.configure({...scrollDefaults(),axis},source);assert.equal(disk.bytes,0);assert.deepEqual(await readdir(lease.directory),['owner.json']);
    }finally{await cleanScrollDirectory(lease);await assert.rejects(lstat(lease.directory),{code:'ENOENT'});}
  }
});
test('disk quota and corrupt strips preserve accepted state; cleanup refuses foreign files and ownership changes',async()=>{
  const lease=await createScrollDirectory(process.env.ONE_SCROLL_TEST_ROOT!);try{
    const disk=new ScrollDiskStorage(lease.directory,lease.token,96*160*4+96*39*4-1),engine=new ScrollStitch(disk);engine.configure(scrollDefaults(),{width:96,height:160});const first=scrollPixels(96,160);engine.sample(first);await assert.rejects(async()=>engine.sample(scrollPixels(96,160,0,39)),/预算/);assert.equal(engine.status().count,1);assert.deepEqual(engine.output(),first);
    const file=join(lease.directory,'1.bgra'),saved=await readFile(file);await writeFile(file,saved.subarray(0,saved.length-1));assert.throws(()=>engine.output(),/改变/);await writeFile(file,saved);
    const altered=Buffer.from(saved);altered[10]^=1;await writeFile(file,altered);assert.throws(()=>engine.output(),/校验失败/);await writeFile(file,saved);assert.deepEqual(engine.output(),first);
    await writeFile(join(lease.directory,'foreign.txt'),'keep');await assert.rejects(cleanScrollDirectory(lease),/非本会话文件/);assert.equal(await readFile(join(lease.directory,'foreign.txt'),'utf8'),'keep');await unlink(join(lease.directory,'foreign.txt'));
    const marker=await readFile(join(lease.directory,'owner.json'));await writeFile(join(lease.directory,'owner.json'),JSON.stringify({token:'wrong'}));assert.throws(()=>disk.read(1),/所有权/);await assert.rejects(cleanScrollDirectory(lease),/所有权/);await writeFile(join(lease.directory,'owner.json'),marker);
  }finally{await cleanScrollDirectory(lease);}
});

test('multiscale search finds irregular large shifts while evaluating fewer original-pixel offsets',context=>{
  const first=scrollPixels(96,4096),next=scrollPixels(96,4096,0,1337),candidates=scrollSearchCandidates(first.pixels,next.pixels,4096,96,0,96);
  assert.ok(candidates.includes(1337));assert.ok(candidates.length<2500);
  context.diagnostic('Large-shift fixture: '+candidates.length+' original-pixel candidates vs '+2*(4096-Math.ceil(4096*.22))+' exhaustive offsets.');
  for(const axis of ['vertical','horizontal'] as const){
    const vertical=axis==='vertical',engine=new ScrollStitch();engine.configure({...scrollDefaults(),axis},{width:vertical?96:4096,height:vertical?4096:96});
    const frame=(offset:number)=>scrollPixels(vertical?96:4096,vertical?4096:96,vertical?0:offset,vertical?offset:0);
    engine.sample(frame(0));assert.equal(engine.sample(frame(1337)).offset,1337);assert.equal(engine.sample(frame(2694)).offset,1357);
    const before=engine.output(),back=engine.sample(frame(1000));assert.equal(back.match,'backwards');assert.equal(back.offset,-1694);assert.deepEqual(engine.output(),before);assert.equal(engine.sample(frame(2694)).match,'unchanged');assert.deepEqual(engine.output(),scrollPixels(vertical?96:6790,vertical?6790:96));
  }
});
test('weak coarse signatures retain exhaustive verification instead of assuming a unique displacement',()=>{
  const flat=new Uint8Array(96*2048*4).fill(255),candidates=scrollSearchCandidates(flat,flat,2048,96,0,96);assert.equal(candidates.length,2*(2048-Math.ceil(2048*.22)));
});
test('multiscale matching retains readable sparse text and whitespace instead of aliasing line spacing',async()=>{
  const labels=Array.from({length:96},(_,line)=>{const text=Array.from({length:34},(_,letter)=>String.fromCharCode(97+((Math.imul(line+31,7919)^Math.imul(letter+7,104729))>>>0)%26)).join('');return `<text x="8" y="${line*32+24}">${line} ${text}</text>`;}).join('');
  const {data,info}=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="3072"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="20" fill="#303030">${labels}</g></svg>`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const frame=(offset:number)=>({width:info.width,height:2048,pixels:new Uint8Array(data.subarray(offset*info.width*4,(offset+2048)*info.width*4))});
  const engine=new ScrollStitch();engine.configure(scrollDefaults(),{width:480,height:2048});engine.sample(frame(0));const result=engine.sample(frame(513));assert.equal(result.match,'accepted');assert.equal(result.offset,513);assert.deepEqual(engine.output().pixels,new Uint8Array(data.subarray(0,2561*480*4)));
});
test('independent local checks reject a false alignment that perfectly matches the old sampling grid',()=>{
  const first=scrollPixels(192,160),matched=scrollPixels(192,160,0,33),mixed=scrollPixels(192,160,0,71),engine=new ScrollStitch();
  for(let y=0;y<160;y++)for(let x=0;x<192;x++)if(x%6===0||x%16===0){const at=(y*192+x)*4;mixed.pixels.set(matched.pixels.subarray(at,at+4),at);}
  engine.configure(scrollDefaults(),{width:192,height:160});engine.sample(first);assert.equal((engine as any).score(first.pixels,mixed.pixels,33,true),0);assert.equal(engine.sample(mixed).match,'ambiguous');assert.equal(engine.status().count,1);assert.deepEqual(engine.output(),first);
});
test('weak moving content is uncertain rather than falsely unchanged, while a narrow blinking column stays unchanged',()=>{
  const low=(offset:number)=>{const frame=scrollPixels(96,160,0,offset);for(let at=0;at<frame.pixels.length;at+=4){frame.pixels[at]=frame.pixels[at+1]=255;frame.pixels[at+2]=253+(frame.pixels[at+2]>>>7);}return frame;};
  const first=low(0),next=low(39),engine=new ScrollStitch();engine.configure(scrollDefaults(),{width:96,height:160});engine.sample(first);assert.ok((engine as any).score(first.pixels,next.pixels,0,true)<.4);assert.equal(engine.sample(next).match,'ambiguous');assert.deepEqual(engine.output(),first);
  const regular=scrollPixels(96,160),blink=scrollPixels(96,160);for(let y=0;y<160;y++)for(let x=90;x<96;x++)blink.pixels.set([0,0,0,255],(y*96+x)*4);
  engine.configure(scrollDefaults(),{width:96,height:160});engine.sample(regular);assert.equal(engine.sample(blink).match,'unchanged');assert.equal(engine.status().count,1);
});

test('automatic motion adapts cautiously, retains overlap and resets for changed scroll speed',()=>{
  const motion=new ScrollMotion();assert.deepEqual(motion.action(0),{kind:'scroll',notches:1,probe:false});motion.sent(0,1,false);motion.accepted(39,328);assert.equal((motion.action(1) as {notches:number}).notches,2);
  motion.sent(1,2,false);motion.accepted(78,328);assert.equal((motion.action(2) as {notches:number}).notches,3);
  motion.sent(2,3,false);motion.accepted(200,328);assert.equal((motion.action(3) as {notches:number}).notches,2);
  motion.sent(3,2,false);motion.accepted(240,328);assert.equal((motion.action(4) as {notches:number}).notches,1);
  motion.reset();assert.equal((motion.action(5) as {notches:number}).notches,1);
});
test('slow loading waits without stacked wheels, allows one small probe, then requests review',()=>{
  const motion=new ScrollMotion();motion.sent(0,1,false);
  for(const now of [1,1000,3000,5999])assert.deepEqual(motion.action(now),{kind:'wait'});
  assert.deepEqual(motion.action(6000),{kind:'scroll',notches:1,probe:true});motion.sent(6000,1,true);assert.deepEqual(motion.action(9999),{kind:'wait'});assert.deepEqual(motion.action(10000),{kind:'end'});
  motion.accepted(78,328);assert.deepEqual(motion.action(10001),{kind:'scroll',notches:2,probe:false});
});

test('native packed pixels survive arbitrary pipe splits and reject invalid layouts before allocation',()=>{
  const info={version:1,format:'bgra8',backend:'wgc',width:4,height:3,stride:16,bytes:48,elapsed:12},pixels=Buffer.from(Array.from({length:48},(_,i)=>i)),bytes=Buffer.concat([Buffer.from(JSON.stringify(info)+'\n'),pixels]);
  for(const split of [1,7,37,512]){const reader=new NativePixelReader();for(let at=0;at<bytes.length;at+=split)reader.append(bytes.subarray(at,at+split));assert.equal(reader.complete,true);const value=reader.finish();assert.deepEqual(Buffer.from(value.frame.pixels),pixels);assert.equal(value.frame.pixels.buffer.byteLength,48);reader.clear();assert.ok(value.frame.pixels.every(byte=>byte===0));}
  for(const change of [{version:2},{format:'rgba8'},{stride:20},{bytes:47},{bytes:FRAME_PIXEL_LIMIT+1},{elapsed:-1},{width:10001,height:1001,stride:40004,bytes:40044004}])assert.throws(()=>new NativePixelReader().append(Buffer.from(JSON.stringify({...info,...change})+'\n')),/无效/);
  assert.throws(()=>new NativePixelReader().append(Buffer.alloc(513,32)),/过大/);
  const partial=new NativePixelReader();partial.append(bytes.subarray(0,bytes.length-1));assert.throws(()=>partial.finish(),/不完整/);partial.clear();
  assert.throws(()=>new NativePixelReader().append(Buffer.concat([bytes,Buffer.from([1])])),/额外/);
});

test('worker owns transferred raw frames, commits only staged frames and skips unchanged previews',async()=>{
  const worker=new Worker(join(__dirname,'capture/scroll-worker.cjs'));let serial=0;
  const command=(kind:string,value?:unknown,transfer:ArrayBuffer[]=[])=>new Promise<any>((resolve,reject)=>{const id=++serial;worker.once('message',message=>{assert.equal(message.id,id);message.error?reject(Error(message.error)):resolve(message);});worker.postMessage({id,kind,value},transfer);});
  try{
    await command('configure',{options:scrollDefaults(),source:{width:96,height:160}});
    const frame=scrollPixels(96,160),original=frame.pixels.slice(),staging=command('stage',{frame,monitored:false},[frame.pixels.buffer as ArrayBuffer]);assert.equal(frame.pixels.byteLength,0);assert.equal((await staging).stable,true);
    const first=await command('commit');assert.equal(first.result.count,1);assert.ok(first.preview);
    const same=scrollPixels(96,160);await command('stage',{frame:same,monitored:false},[same.pixels.buffer as ArrayBuffer]);const unchanged=await command('commit');assert.equal(unchanged.result.match,'unchanged');assert.equal(unchanged.preview,null);
    const next=scrollPixels(96,160,0,39);await command('stage',{frame:next,monitored:false},[next.pixels.buffer as ArrayBuffer]);await command('release-frame');await assert.rejects(command('commit'),/已失效/);
    const output=await command('output');assert.deepEqual(output.output.pixels,original);assert.equal(output.output.height,160);
  }finally{await worker.terminate();}
});
function scrollPixels(width: number, height: number, x = 0, y = 0) {
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      let v = Math.imul(col + x + 17, 1103515245) ^ Math.imul(row + y + 31, 2654435761);
      v ^= v >>> 13;
      v = Math.imul(v, 2246822519);
      v ^= v >>> 16;
      const i = (row * width + col) * 4;
      pixels.set([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, 255], i);
    }
  return { width, height, pixels };
}
test('automatic scrolling waits for the final smooth-scroll frame before appending original pixels', () => {
  for (const axis of ['vertical', 'horizontal'] as const) {
    const vertical = axis === 'vertical',
      source = { width: vertical ? 96 : 160, height: vertical ? 160 : 96 },
      options = { ...scrollDefaults(), axis },
      engine = new ScrollStitch(),
      settle = new ScrollSettle(options, source);
    engine.configure(options, source);
    engine.sample(scrollPixels(source.width, source.height));
    const frame = (offset: number) =>
      scrollPixels(source.width, source.height, vertical ? 0 : offset, vertical ? offset : 0);
    for (const [time, offset] of [
      [0, 4],
      [140, 17],
      [280, 29],
      [420, 39],
      [560, 39],
    ]) {
      assert.equal(settle.observe(frame(offset), time), false);
      assert.equal(engine.status().count, 1, 'moving frames must never enter the stitched result');
    }
    assert.equal(settle.observe(frame(39), 700), true);
    assert.equal(engine.sample(frame(39)).offset, 39);
    assert.deepEqual(engine.output(), scrollPixels(vertical ? 96 : 199, vertical ? 199 : 96));
    settle.reset();
    assert.equal(
      settle.observe(frame(39), 800),
      false,
      'every wheel starts a fresh quiet interval',
    );
  }
});
test('scroll settling excludes configured fixed edges and tolerates a narrow changing column', () => {
  const source = { width: 120, height: 160 },
    options = { ...scrollDefaults(), trimStart: 16, trimEnd: 8, ignoreEnd: 8 },
    settle = new ScrollSettle(options, source);
  const frame = (n: number) => {
    const f = scrollPixels(source.width, source.height);
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++)
        if (y < 16 || y >= 152 || x >= 112 || x === 60)
          f.pixels.fill(n, (y * source.width + x) * 4, (y * source.width + x) * 4 + 3);
    return f;
  };
  assert.equal(settle.observe(frame(0), 0), false);
  assert.equal(settle.observe(frame(255), 140), false);
  assert.equal(settle.observe(frame(128), 280), true);
  const broad = scrollPixels(source.width, source.height, 800);
  assert.equal(settle.observe(broad, 420), false, 'a broad change resets the interval');
  assert.equal(settle.observe(broad, 560), false);
  assert.equal(settle.observe(broad, 700), true);
});
test('settling cannot confuse elapsed time, rapid duplicate samples or gradual drift with a quiet frame', () => {
  const source = { width: 96, height: 160 },
    settle = new ScrollSettle(scrollDefaults(), source),
    blank = scrollPixels(source.width, source.height);
  blank.pixels.fill(0);
  const changed = (n: number) => {
    const f = { ...blank, pixels: blank.pixels.slice() };
    for (let i = 0; i < f.pixels.length; i += 4) f.pixels[i] = n;
    return f;
  };
  assert.equal(settle.observe(blank, 0), false);
  assert.equal(settle.observe(blank, 1), false);
  assert.equal(settle.observe(blank, 2), false);
  assert.equal(settle.observe(changed(1), 140), false);
  assert.equal(
    settle.observe(changed(2), 280),
    false,
    'compare to the interval anchor, not just the previous sample',
  );
  assert.equal(settle.observe(changed(2), 420), false);
  assert.equal(settle.observe(changed(2), 560), true);
  assert.throws(() => settle.observe(blank, 500), /时间/);
  assert.throws(() => settle.observe(blank, NaN), /时间/);
  assert.throws(() => settle.observe(scrollPixels(95, 160), 700), /尺寸/);
});
test('continuous animation never becomes a stable scroll frame and resetting releases the old anchor', () => {
  const settle = new ScrollSettle(scrollDefaults(), { width: 96, height: 160 });
  for (let i = 0; i < 30; i++)
    assert.equal(settle.observe(scrollPixels(96, 160, i * 13, i * 7), i * 140), false);
  settle.reset();
  const final = scrollPixels(96, 160, 100);
  assert.equal(settle.observe(final, 0), false);
  assert.equal(settle.observe(final, 140), false);
  assert.equal(settle.observe(final, 280), true);
});
test('moving frames preserve exact continuous content and reject a corrupt intermediate viewport without pending recovery',()=>{
  for(const axis of ['vertical','horizontal'] as const){
    const vertical=axis==='vertical',width=vertical?96:160,height=vertical?160:96;
    const image=(offset:number,cross=0)=>scrollPixels(width,height,vertical?cross:offset,vertical?offset:cross);
    const engine=new ScrollStitch();engine.configure({...scrollDefaults(),axis},{width,height});engine.sample(image(0));
    for(let offset=39;offset<=390;offset+=39){
      const previous=engine.output();engine.sample(image(offset,11),[],true);
      assert.equal(engine.status().pending,false);assert.deepEqual(engine.output(),previous);
      assert.equal(engine.sample(image(offset),[],true).match,'accepted');
    }
    assert.deepEqual(engine.output(),scrollPixels(vertical?96:550,vertical?550:96));
  }
});

test('scrolling capture preserves exact pixels across irregular vertical and horizontal overlaps, undo and backtracking', () => {
  for (const axis of ['vertical', 'horizontal'] as const) {
    const engine = new ScrollStitch(),
      vertical = axis === 'vertical',
      source = { width: vertical ? 96 : 160, height: vertical ? 160 : 96 };
    engine.configure({ ...scrollDefaults(), axis }, source);
    engine.sample(scrollPixels(source.width, source.height));
    for (const offset of [37, 89, 141]) {
      const status = engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : offset, vertical ? offset : 0),
      );
      assert.equal(status.match, 'accepted');
      assert.equal(status.offset, offset === 37 ? 37 : 52);
    }
    assert.equal(
      engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : 141, vertical ? 141 : 0),
      ).match,
      'unchanged',
    );
    assert.equal(
      engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : 120, vertical ? 120 : 0),
      ).match,
      'backwards',
    );
    const actual = engine.output();
    assert.deepEqual(actual, scrollPixels(vertical ? 96 : 301, vertical ? 301 : 96));
    const undone = engine.undo();
    assert.equal(undone.count, 3);
    assert.deepEqual(engine.output(), scrollPixels(vertical ? 96 : 249, vertical ? 249 : 96));
    assert.equal(
      engine.sample(
        scrollPixels(source.width, source.height, vertical ? 0 : 141, vertical ? 141 : 0),
      ).match,
      'accepted',
    );
    assert.deepEqual(engine.output(), actual);
    assert.ok(engine.preview()!.width <= 300 && engine.preview()!.height <= 4096);
  }
});
test('scrolling capture removes explicit fixed edges and ignores a dynamic side while preserving remaining pixels', () => {
  const engine = new ScrollStitch(),
    source = { width: 96, height: 184 };
  engine.configure({ ...scrollDefaults(), trimStart: 16, trimEnd: 8, ignoreEnd: 8 }, source);
  const frame = (offset: number, animate: number) => {
    const body = scrollPixels(96, 160, 0, offset),
      result = new Uint8Array(96 * 184 * 4);
    result.set(body.pixels, 96 * 16 * 4);
    for (let y = 16; y < 176; y++)
      for (let x = 88; x < 96; x++) result.fill(animate, (y * 96 + x) * 4, (y * 96 + x + 1) * 4);
    return { ...source, pixels: result };
  };
  engine.sample(frame(0, 10));
  assert.equal(engine.sample(frame(47, 200)).match, 'accepted');
  const output = engine.output(),
    expected = scrollPixels(96, 207);
  for (let y = 0; y < 207; y++)
    assert.deepEqual(
      output.pixels.slice(y * 96 * 4, (y * 96 + 88) * 4),
      expected.pixels.slice(y * 96 * 4, (y * 96 + 88) * 4),
    );
  assert.equal(output.height, 207);
});
test('uncertain scrolling content requires explicit join, rejected dimensions preserve the last usable result', () => {
  const engine = new ScrollStitch();
  engine.configure(scrollDefaults(), { width: 96, height: 160 });
  engine.sample(scrollPixels(96, 160));
  const before = engine.output();
  const unrelated = scrollPixels(96, 160, 999, 777);
  assert.equal(engine.sample(unrelated).match, 'ambiguous');
  assert.deepEqual(engine.output(), before);
  assert.throws(() => engine.sample(unrelated), /上一帧/);
  assert.throws(() => engine.join(159), /位移/);
  assert.equal(engine.join(40).count, 2);
  assert.equal(engine.output().height, 200);
  engine.undo();
  assert.deepEqual(engine.output(), before);
  assert.throws(() => engine.sample(scrollPixels(90, 160)), /尺寸/);
  assert.deepEqual(engine.output(), before);
  assert.throws(
    () => engine.configure({ ...scrollDefaults(), trimStart: 120 }, { width: 96, height: 160 }),
    /64/,
  );
});
test('repeating scrolling patterns do not turn an equally plausible overlap into an automatic join', () => {
  const engine = new ScrollStitch();
  engine.configure(scrollDefaults(), { width: 80, height: 160 });
  const repeated = (offset: number) => {
    const frame = scrollPixels(80, 160);
    for (let y = 0; y < 160; y++)
      frame.pixels.set(scrollPixels(80, 1, 0, (y + offset) % 24).pixels, y * 80 * 4);
    return frame;
  };
  engine.sample(repeated(0));
  const before = engine.output(),
    status = engine.sample(repeated(17));
  assert.equal(status.match, 'ambiguous');
  assert.equal(status.pending, true);
  assert.deepEqual(engine.output(), before);
});
