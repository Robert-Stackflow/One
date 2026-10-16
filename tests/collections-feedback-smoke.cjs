const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function seedRecording(profile){
 const bundle=require('esbuild').buildSync({stdin:{contents:`export {MaterialLibrary} from './src/main/materials/library';export {RecordingFile} from './src/main/recording/recording-file';export {saveRecordingProject} from './src/main/recording/recording-project';export {defaultPlayback} from './src/shared/recording/recording-playback';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});
 const m={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(m,m.exports,require);
 const {MaterialLibrary,RecordingFile,saveRecordingProject,defaultPlayback}=m.exports;
 const library=new MaterialLibrary(path.join(profile,'materials'),()=>Buffer.alloc(0));await library.init();
 const media=new RecordingFile(profile,undefined,'webm'),id=require('node:crypto').randomUUID(),raw=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('batch-export-fixture')]);
 try{
  await media.create();await media.append(0,raw);await media.finish();
  const playback=defaultPlayback(),project={format:'one-recording',version:1,seconds:1,options:{mode:'video',container:'webm',sourceId:'screen:0:0',systemAudio:false,microphone:false,microphoneId:'',fps:30,maxWidth:1920},video:{width:480,height:240,fps:30,encoder:'fixture'},playback,inputs:[],annotations:[],layouts:[]};
  await library.addRecording({id,title:'录制测试',created:Date.now(),seconds:1,bytes:raw.length,mode:'video'},file=>saveRecordingProject(file,project,[{kind:'screen',file:media}],()=>true),playback);
 }finally{await media.dispose();}
 return id;
}
(async()=>{
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/collections-feedback'),profile=path.join(output,'profile-'+Date.now()),exports=path.join(output,'exports-'+Date.now()),files=path.join(profile,'files');
 await fs.mkdir(files,{recursive:true});await fs.mkdir(exports,{recursive:true});const recordId=await seedRecording(profile);
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;let app;const errors=[];
 try{
  app=await electron.launch({args:[path.resolve('.')],env});app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));
  const main=await app.firstWindow();await main.waitForSelector('.nav[data-page=materials]');
  await app.evaluate(async({dialog,nativeImage,BrowserWindow},{files,exports})=>{
   const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');
   global.batchFiles=[path.join(files,'first.png'),path.join(files,'second.png')];global.batchExport=exports;global.batchCancel=false;global.batchDialogs=0;
   for(let i=0;i<2;i++)await fs.writeFile(global.batchFiles[i],nativeImage.createFromBitmap(Buffer.alloc(80*50*4,160+i*50),{width:80,height:50}).toPNG());
   await fs.mkdir(path.join(files,'nested'),{recursive:true});await fs.writeFile(path.join(files,'nested','child.txt'),'Native directory tree icon');await fs.writeFile(path.join(files,'document.txt'),'System icon preview');await fs.writeFile(path.join(files,'unknown.onefixture'),'Unsupported preview');
   dialog.showOpenDialog=async(_window,options)=>{if(options.properties.includes('openDirectory')){global.batchDialogs++;return{canceled:global.batchCancel,filePaths:global.batchCancel?[]:[global.batchExport]};}return{canceled:false,filePaths:global.batchFiles};};
   BrowserWindow.getAllWindows()[0].setSize(1120,800);
  },{files,exports});
  await main.locator('.nav[data-page=materials]').click();await main.getByRole('button',{name:'导入图片',exact:true}).click();
  const cards=main.locator('#material-results .asset-card');await expect(cards).toHaveCount(2);
  await main.locator('[data-material-select]').first().check();await expect(main.locator('#materials-select-all')).toHaveJSProperty('indeterminate',true);
  await main.locator('#material-search').fill('first');await expect(cards).toHaveCount(1);await expect(main.locator('[data-material-select]')).not.toBeChecked();
  await main.locator('#materials-select-all').check();await main.locator('#material-search').fill('');await expect(cards).toHaveCount(2);
  await main.locator('#materials-select-all').check();
  await app.evaluate(()=>{global.batchCancel=true;});await main.getByRole('button',{name:'导出所选',exact:true}).click();await expect(main.getByRole('button',{name:'导出所选',exact:true})).toBeEnabled();assert.deepEqual(await fs.readdir(exports),[]);
  await expect(main.locator('.materials-selection')).toContainText('已选 2 项');await app.evaluate(()=>{global.batchCancel=false;});
  await main.getByRole('button',{name:'导出所选',exact:true}).click();await expect(main.locator('#toast')).toContainText('已导出 2 项');const originals=await fs.readdir(exports);assert.equal(originals.length,2);
  await main.locator('#materials-select-all').check();await main.getByRole('button',{name:'导出所选',exact:true}).click();await expect(main.locator('#toast')).toContainText('已导出 2 项');await expect.poll(()=>fs.readdir(exports).then(f=>f.length)).toBe(4);
  for(const name of originals)assert.deepEqual(await fs.readFile(path.join(exports,name)),await fs.readFile(path.join(files,name.startsWith('first-')?'first.png':'second.png')));
  const imageIds=(await main.evaluate(()=>window.one.materialsState())).images.map(i=>i.id);
  await main.evaluate(id=>window.one.materialsEditImage(id),imageIds[0]);let editor;await expect.poll(()=>!!(editor=app.windows().find(p=>p.url().includes('view=image-editor')))).toBe(true);await editor.waitForFunction(()=>document.body.dataset.editorReady==='true');
  await main.locator('#materials-select-all').check();await main.getByRole('button',{name:'删除所选',exact:true}).click();await main.getByRole('dialog',{name:'删除所选素材'}).getByRole('button',{name:'取消',exact:true}).click();await expect(cards).toHaveCount(2);
  await main.getByRole('button',{name:'删除所选',exact:true}).click();await main.getByRole('dialog',{name:'删除所选素材'}).getByRole('button',{name:'删除',exact:true}).click();await expect(cards).toHaveCount(1);await expect(main.locator('#toast')).toContainText('请先关闭当前图片编辑');await expect(main.locator('[data-material-select]')).toBeChecked();
  await editor.getByRole('button',{name:'关闭',exact:true}).click();await expect.poll(()=>editor.isClosed()).toBe(true);
  await main.getByRole('button',{name:'贴出所选',exact:true}).click();await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.length)).toBe(1);
  await main.getByRole('tab',{name:/^录制/}).click();await expect(cards).toHaveCount(1);await cards.first().getByRole('button',{name:'导出录制工程',exact:true}).click();await expect.poll(()=>fs.readdir(exports).then(f=>f.filter(n=>n.endsWith('.onerec')).length)).toBe(1);await main.locator('#materials-select-all').check();
  await main.getByRole('button',{name:'导出所选',exact:true}).click();await expect.poll(()=>fs.readdir(exports).then(f=>f.filter(n=>n.endsWith('.onerec')).length)).toBe(2);
  const recordName=(await fs.readdir(exports)).find(n=>n.endsWith('.onerec'));assert.deepEqual(await fs.readFile(path.join(exports,recordName)),await fs.readFile(path.join(profile,'materials','recordings',recordId,'project.onerec')));
  await main.locator('#materials-select-all').check();await main.getByRole('button',{name:'删除所选',exact:true}).click();await main.getByRole('dialog',{name:'删除所选素材'}).getByRole('button',{name:'删除',exact:true}).click();await expect(cards).toHaveCount(0);
  await main.evaluate(async p=>{await window.one.patchSettings({appearance:{mode:'dark'},capture:{uiScale:150}});await window.one.pinsFiles();},files);
  await main.locator('.nav[data-page=pins]').click();await expect(main.locator('.pin-card')).toHaveCount(2);await main.locator('#page-pins [data-collection-toggle]').click();await main.locator('#pins-select-all').check();
  await main.getByRole('button',{name:'删除所选贴图',exact:true}).click();await main.getByRole('dialog',{name:'删除所选贴图'}).getByRole('button',{name:'取消',exact:true}).click();await expect(main.locator('.pin-card')).toHaveCount(2);
  await main.getByRole('button',{name:'删除所选贴图',exact:true}).click();await main.getByRole('dialog',{name:'删除所选贴图'}).getByRole('button',{name:'删除',exact:true}).click();await expect(main.locator('.pin-card')).toHaveCount(0);assert.equal((await main.evaluate(()=>window.one.materialsState())).images.length,1);
  await fs.access(path.join(files,'first.png'));await fs.access(path.join(files,'second.png'));
  await main.evaluate(()=>window.one.patchSettings({appearance:{mode:'light'},capture:{uiScale:100}}));
  const previewReady=app.waitForEvent('window',{predicate:p=>p.url().includes('view=preview')});await main.evaluate(p=>window.one.preview(p),path.join(files,'unknown.onefixture'));const preview=await previewReady;
  await expect(preview.locator('#preview-title-icon .windows-file-icon')).toBeVisible();await expect(preview.locator('.preview-unsupported .windows-file-icon')).toBeVisible();
  const iconImage=await preview.evaluate(async()=>{const d=await window.one.previewData();return(await window.one.fileIcons([d.path]))[d.path];});assert.equal(await preview.locator('#preview-title-icon img').getAttribute('src'),iconImage);
  await preview.locator('#preview-files').click();await preview.locator('#side-details').click();await expect(preview.locator('#detail-cover .windows-file-icon')).toBeVisible();await preview.locator('#side-files').click();await expect(preview.locator('.file-list-row .windows-file-icon')).toHaveCount(5);
  await preview.evaluate(()=>window.one.previewPreferences({held:true}));await preview.locator('.file-list-row').filter({hasText:'document.txt'}).click();await expect(preview.locator('#preview-name')).toHaveText('document.txt');await expect(preview.locator('#preview-title-icon [data-file-icon]')).toHaveAttribute('data-file-icon',path.join(files,'document.txt'));await expect(preview.locator('#preview-title-icon img')).toBeVisible();
  await preview.locator('.file-list-row').filter({hasText:'nested'}).click();await expect(preview.locator('#preview-name')).toHaveText('nested');await expect(preview.locator('.directory-tree .windows-file-icon')).toHaveCount(1);
  for(const mode of ['light','dark']){await main.evaluate(mode=>window.one.patchSettings({appearance:{mode}}),mode);assert.equal(await main.locator('#page-pins').evaluate(p=>p.scrollWidth>p.clientWidth+1),false);}
  assert.deepEqual(errors,[]);const result={result:'PASS',materialBatchSelection:true,batchExportCancelAndNoOverwrite:true,activeEditorPartialDelete:true,recordingExportDelete:true,pinBatchDeletePreservesMaterialsAndFiles:true,nativePreviewIconsAndNavigation:true};await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}}
})().catch(error=>{console.error(error);process.exitCode=1;});
