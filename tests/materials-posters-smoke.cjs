const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
async function seed(profile){
 const bundle=require('esbuild').buildSync({stdin:{contents:`export {MaterialLibrary} from './src/main/materials/library';export {RecordingFile} from './src/main/recording/recording-file';export {saveRecordingProject} from './src/main/recording/recording-project';export {defaultPlayback} from './src/shared/recording/recording-playback';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});
 const m={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(m,m.exports,require);
 const {MaterialLibrary,RecordingFile,saveRecordingProject,defaultPlayback}=m.exports;
 const library=new MaterialLibrary(path.join(profile,'materials'),()=>Buffer.alloc(0));await library.init();
 const ids=[];
 for(let i=0;i<2;i++){
  const container=i?'mp4':'webm',raw=await fs.readFile(i?'tests/fixtures/image-preview/motion.mp4':'tests/fixtures/motion.webm');
  const media=new RecordingFile(profile,undefined,container),id=require('node:crypto').randomUUID();ids.push(id);
  try{
   await media.create();await media.append(0,raw);await media.finish();
   const playback=defaultPlayback(),project={format:'one-recording',version:1,seconds:1,options:{mode:'video',container,sourceId:'screen:0:0',systemAudio:false,microphone:false,microphoneId:'',fps:30,maxWidth:1920},video:{width:480,height:240,fps:30,encoder:'fixture'},playback,inputs:[],annotations:[],layouts:[]};
   await library.addRecording({id,title:'录制预览 '+i,created:Date.now()+i,seconds:1,bytes:raw.length,mode:'video'},file=>saveRecordingProject(file,project,[{kind:'screen',file:media}],()=>true),playback);
   if(i)await fs.writeFile(path.join(profile,'materials','recordings',id,'thumbnail.png'),'corrupt poster');
  }finally{await media.dispose();}
 }
 return ids;
}
(async()=>{
 const root=path.resolve('work/current');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'materials-posters-')),profile=path.join(directory,'profile');let app;
 try{
  const ids=await seed(profile),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:directory,TMP:directory};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const main=await app.firstWindow(),errors=[];main.on('pageerror',error=>errors.push(error.message));main.on('console',message=>{if(message.type()==='error')console.log('renderer:',message.text().slice(0,500));});main.on('requestfailed',request=>console.log('request failed:',request.url().slice(0,160),request.failure()));
  await main.locator('.nav[data-page=materials]').click();await main.locator('#material-recordings').click();
  const posters=main.locator('.recording-preview img');await expect(posters).toHaveCount(2);
  try{await expect.poll(()=>posters.evaluateAll(images=>images.every(img=>!img.hidden&&img.naturalWidth>0)),{timeout:20000}).toBe(true);}catch(error){console.log('posters:',await posters.evaluateAll(images=>images.map(img=>({src:img.src.slice(0,160),complete:img.complete,hidden:img.hidden,width:img.naturalWidth}))));console.log('API:',await main.evaluate(()=>typeof window.one.materialsSaveRecordingThumbnail));throw error;}
  const caches=ids.map(id=>path.join(profile,'materials','recordings',id,'thumbnail.png'));
  await expect.poll(()=>Promise.all(caches.map(file=>fs.readFile(file).then(bytes=>bytes.length>24).catch(()=>false))).then(values=>values.every(Boolean))).toBe(true);
  const before=await Promise.all(caches.map(file=>fs.readFile(file)));
  for(const png of before){const image=sharp(png),meta=await image.metadata();assert.equal(meta.format,'png');assert(meta.width<=480&&meta.height<=480);const {channels}=await image.stats();assert(channels.some(channel=>channel.stdev>1),'poster contains decoded picture content');}
  const mediaRequests=[];main.on('request',request=>{if(request.url().startsWith('one-file://materials/')&&request.url().endsWith('/media'))mediaRequests.push(request.url());});
  await main.locator('.nav[data-page=home]').click();await main.locator('.nav[data-page=materials]').click();
  await expect.poll(()=>posters.evaluateAll(images=>images.every(img=>!img.hidden&&img.naturalWidth>0&&img.src.startsWith('one-file:')))).toBe(true);
  assert.deepEqual(mediaRequests,[],'reopening uses cached PNG, not video decoders');
  assert.deepEqual(await Promise.all(caches.map(file=>fs.readFile(file))),before);
  assert.match(await main.evaluate(async id=>{try{await window.one.materialsSaveRecordingThumbnail(id,new Uint8Array(1048577));return '';}catch(error){return error.message;}},ids[0]),/预览图无效/);
  assert.deepEqual(errors,[]);
  console.log('PASS: missing/corrupt recording posters decode real WebM/MP4 original frames, cache bounded PNGs, reuse cache without media requests and reject oversized writes.');
 }finally{
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert(path.basename(actual).startsWith('materials-posters-'));await fs.rm(actual,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
