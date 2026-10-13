const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{PNG}=require('pngjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const projectModule={exports:{}},projectBundle=require('esbuild').buildSync({entryPoints:['src/main/recording/recording-project.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});
new Function('module','exports','require',projectBundle.outputFiles[0].text)(projectModule,projectModule.exports,require);
async function run(){
  const out=path.resolve('work/current/capture-migration/data-lifecycle');await fs.mkdir(out,{recursive:true});
  const root=await fs.mkdtemp(path.join(out,'fixture-')),profile=path.join(root,'profile'),recording=path.join(profile,'recording'),native=path.join(recording,'native');
  await fs.writeFile(path.join(root,'.one-fixture'),'One cross-feature data lifecycle');let app,main;const errors=[];
  const draftId='audio-'+randomUUID(),invalidId='audio-'+randomUUID(),foreignId='audio-'+randomUUID(),draft=path.join(native,draftId),invalid=path.join(native,invalidId),foreign=path.join(native,foreignId);
  const wave=Buffer.alloc(44+4800*4+3);wave.write('RIFF');wave.writeUInt32LE(0,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);wave.writeUInt32LE(48000,24);wave.writeUInt32LE(192000,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);wave.write('data',36);
  for(const directory of [draft,invalid,foreign]){await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'draft.json'),JSON.stringify({version:1,createdAt:Date.now(),format:'wav',systemAudio:true,microphone:false}));}
  await fs.writeFile(path.join(draft,'.one-audio'),'One native audio');await fs.writeFile(path.join(draft,'capture.wav'),wave);
  await fs.writeFile(path.join(invalid,'.one-audio'),'One native audio');await fs.writeFile(path.join(invalid,'capture.wav'),'incomplete header');
  await fs.writeFile(path.join(foreign,'.one-audio'),'unowned fixture');await fs.writeFile(path.join(foreign,'capture.wav'),wave);
  const scratch=path.join(recording,'compose-ABC123'),unowned=path.join(recording,'compose-XYZ987'),job=randomUUID(),output=path.join(root,'outputs');await fs.mkdir(output);
  const stage=path.join(output,'.One-compose-'+job+'.part'),final=path.join(output,'keep.gif'),sealed=path.join(recording,'record-'+randomUUID()+'.sealed');
  await fs.mkdir(scratch);await fs.mkdir(unowned);await fs.writeFile(path.join(scratch,'.one-compose'),JSON.stringify({version:1,id:job,stage}));await fs.writeFile(stage,'interrupted output');await fs.writeFile(final,'published output');await fs.writeFile(path.join(unowned,'keep.txt'),'unowned scratch');await fs.writeFile(sealed,'unrecoverable encrypted process cache');
  const pngPath=path.join(root,'原图.png'),png=new PNG({width:8,height:6});png.data.fill(255);const originalPNG=PNG.sync.write(png);await fs.writeFile(pngPath,originalPNG);
  const exists=file=>fs.stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  const state=()=>main.evaluate(()=>window.one.recording.state());
  async function launch(){
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);
    await app.evaluate(({dialog},pngPath)=>{global.lifecycleQuestions=0;global.lifecycleAnswer=2;global.lifecycleSaveCancel=true;dialog.showMessageBox=async(_owner,options)=>{if(options.title!=='退出 One')throw Error('Unexpected confirmation');global.lifecycleQuestions++;return {response:global.lifecycleAnswer,checkboxChecked:false};};dialog.showSaveDialog=async()=>({canceled:global.lifecycleSaveCancel,filePath:undefined});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[pngPath]});},pngPath);
    await expect.poll(async()=>(await state()).audioDrafts?.length).toBe(2);return main;
  }
  async function abruptExit(){if(!app)return;const current=app,closed=current.waitForEvent('close',{timeout:15000});await current.evaluate(({app})=>app.exit(0)).catch(error=>{if(!/closed|Target|exit/i.test(String(error)))throw error;});await closed;app=undefined;}
  async function quitCanceled(answer){const previous=await app.evaluate(()=>global.lifecycleQuestions);await app.evaluate(({app},answer)=>{global.lifecycleAnswer=answer;setTimeout(()=>app.quit(),0);},answer);await expect.poll(()=>app.evaluate(()=>global.lifecycleQuestions)).toBe(previous+1);await expect.poll(async()=>(await state()).phase).toBe('ready');assert.ok(await exists(path.join(draft,'capture.wav')));}
  try{
    await launch();assert.equal(await exists(scratch),false);assert.equal(await exists(stage),false);assert.equal(await exists(sealed),false);assert.equal(await fs.readFile(final,'utf8'),'published output');assert.equal(await fs.readFile(path.join(unowned,'keep.txt'),'utf8'),'unowned scratch');
    let recordingState=await state();assert.equal(recordingState.audioDrafts.find(item=>item.id===draftId).samples,4800);assert.equal(recordingState.audioDrafts.find(item=>item.id===invalidId).samples,0);assert.ok(!recordingState.audioDrafts.some(item=>item.id===foreignId));assert.equal(hash(await fs.readFile(path.join(draft,'capture.wav'))),hash(wave));
    const [imageId]=await main.evaluate(()=>window.one.materialsImportImages()),pinId=await main.evaluate(id=>window.one.pinsOpenMaterial(id),imageId);
    const imageBefore=(await main.evaluate(()=>window.one.materialsState())).images[0],pinBefore=(await main.evaluate(()=>window.one.pinsState())).pins[0];assert.equal(pinBefore.id,pinId);
    await main.locator('.nav[data-page=recording]').click();await expect(main.locator('.recording-page .audio-draft-row')).toHaveCount(2);
    const materialRoot=path.join(profile,'materials','recordings'),held=materialRoot+'.held';await fs.rename(materialRoot,held);await fs.writeFile(materialRoot,'owned fixture write failure');
    await main.evaluate(id=>window.one.recording.recoverAudio(id),draftId);recordingState=await state();assert.equal(recordingState.phase,'ready');assert.equal(recordingState.projectSaved,'');assert.match(recordingState.message,/自动保存失败/);
    assert.equal(hash(await fs.readFile(path.join(draft,'capture.wav'))),hash(wave));await quitCanceled(2);await quitCanceled(0);
    await fs.unlink(materialRoot);await fs.rename(held,materialRoot);
    await fs.unlink(path.join(profile,'materials','images',imageId+'.thumb.png'));
    await abruptExit();await launch();
    const imageAfter=(await main.evaluate(()=>window.one.materialsState())).images[0],pinAfter=(await main.evaluate(()=>window.one.pinsState())).pins[0];assert.equal(imageAfter.hash,imageBefore.hash);assert.deepEqual(pinAfter.content,pinBefore.content);assert.equal(pinAfter.view.visible,false);assert.equal(pinAfter.view.passThrough,false);
    await main.locator('.nav[data-page=materials]').click();await expect(main.locator('.asset-preview img').first()).toHaveJSProperty('naturalWidth',8);assert.equal(await exists(path.join(profile,'materials','images',imageId+'.thumb.png')),true);
    await main.locator('.nav[data-page=recording]').click();await expect(main.locator('.recording-page .audio-draft-row')).toHaveCount(2);await main.evaluate(id=>window.one.recording.recoverAudio(id),draftId);
    await expect.poll(async()=>(await main.evaluate(()=>window.one.materialsState())).recordings.length).toBe(1);assert.equal((await state()).projectDirty,false);assert.equal(hash(await fs.readFile(path.join(draft,'capture.wav'))),hash(wave));
    const recordingId=(await main.evaluate(()=>window.one.materialsState())).recordings[0].id;
    const imported=await projectModule.exports.openRecordingProject(path.join(materialRoot,recordingId,'project.onerec'),path.join(root,'verified-project'),()=>true);
    try{const chunks=[];for await(const chunk of imported.file.read())chunks.push(chunk);const expectedWave=Buffer.from(wave.subarray(0,wave.length-3));expectedWave.writeUInt32LE(expectedWave.length-8,4);expectedWave.writeUInt32LE(expectedWave.length-44,40);assert.deepEqual(Buffer.concat(chunks),expectedWave);assert.equal(imported.project.format,'one-recording');}finally{await imported.file.dispose();}
    await main.locator('.nav[data-page=home]').click();await main.locator('.nav[data-page=recording]').click();assert.equal((await state()).phase,'ready');
    await main.evaluate(()=>window.one.recording.cancel());assert.equal(await exists(draft),false);assert.equal(await exists(invalid),true);await main.evaluate(id=>window.one.recording.discardAudioDraft(id),invalidId);assert.equal(await exists(invalid),false);assert.equal(await exists(foreign),true);
    assert.equal((await main.evaluate(()=>window.one.materialsState())).recordings.length,1);assert.deepEqual(await fs.readFile(pngPath),originalPNG);assert.equal(hash(await fs.readFile(path.join(foreign,'capture.wav'))),hash(wave));assert.deepEqual(errors,[]);
    await app.close();app=undefined;
    const result={result:'PASS',actualOne:true,ownedScratchCleanup:true,unownedAndPublishedPreserved:true,originalDraftPreserved:true,partialPCMFrameIgnored:true,materialWriteFailureVisible:true,quitAndSaveCancelPreserved:true,abruptExitRecovery:true,imageAndPinSurvive:true,thumbnailRegenerated:true,recoveredRecordingArchived:true,explicitDiscardOnly:true,asyncWaits:'expect.poll'};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));await fs.unlink(path.join(out,'failure.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});console.log(result);
  }catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),state:app?await state().catch(()=>null):null},null,2));throw error;}
  finally{await abruptExit();const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(out));assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One cross-feature data lifecycle');await fs.rm(actual,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
