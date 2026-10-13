import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,rmdir,realpath,rename,unlink,link} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {MaterialLibrary} from '../../src/main/materials/library';
import {readImageProject} from '../../src/main/capture/image-project';
import {saveRecordingProject,recordingProjectInfo} from '../../src/main/recording/recording-project';
import {RecordingFile} from '../../src/main/recording/recording-file';
import {ImageHistory} from '../../src/shared/capture/image-document';
import {defaultPlayback} from '../../src/shared/recording/recording-playback';
import {MATERIAL_INDEX_FORMAT} from '../../src/shared/materials';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4WQAAAAASUVORK5CYII=','base64');
async function fixture(work:(root:string)=>Promise<void>){
  const parent=resolve('work/current/capture-migration');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'materials-'));
  try{await work(root);}finally{const actual=await realpath(root);assert.ok(actual.startsWith(parent+sep));await rm(actual,{recursive:true,force:true});}
}
test('One materials preserve image originals, editable history, thumbnails and stable identities across reopening',()=>fixture(async root=>{
  let changes=0;const library=new MaterialLibrary(join(root,'materials'),()=>png,()=>changes++);await library.init();
  const history=new ImageHistory(1,1,true);history.commit({...history.value,effects:{...history.value.effects,border:{width:1,color:'#123456'}}});
  const asset=await library.images.add(png,'可编辑截图','capture',history.value,png,history.snapshot);
  assert.equal(Object.hasOwn(asset,'thumbnail'),false);assert.equal(changes,1);
  const file=library.imagePath(asset.id);assert.ok(file.endsWith('.oneimage'));
  const project=await readImageProject(file);assert.deepEqual(project.png,png);assert.equal(project.project.document.effects.border.color,'#123456');
  assert.ok(project.project.history);
  assert.deepEqual(await library.images.read(asset.id,true),png);
  const restarted=new MaterialLibrary(library.directory,()=>png);await restarted.init();await restarted.init();
  assert.deepEqual(restarted.images.list(),[asset]);assert.deepEqual(await restarted.images.detail(asset.id),{id:asset.id,title:asset.title,hash:asset.hash,payload:{png:png.toString('base64')}});
  assert.throws(()=>library.protect(join(library.directory,'recordings','result.onerec')),/素材目录/);
  assert.throws(()=>library.imagePath('../escape'),/素材不存在/);
  assert.throws(()=>library.images.get('../escape'),/素材不存在/);
  await restarted.removeImage(asset.id);assert.deepEqual(restarted.images.list(),[]);
  assert.deepEqual((await readdir(join(library.directory,'images'))).sort(),['index.json']);
}));

test('Image previews rebuild from verified originals after eviction, without racing deletion or changing projects',()=>fixture(async root=>{
  let renders=0;
  const library=new MaterialLibrary(root,()=>{renders++;return png;});await library.init();
  const asset=await library.images.add(png,'cached','file');
  const thumbnail=join(root,'images',asset.id+'.thumb.png'),original=join(root,'images',asset.id+'.png');
  const project=await readFile(library.imagePath(asset.id)),index=await readFile(join(root,'images','index.json'));
  await unlink(thumbnail);
  assert.deepEqual(await Promise.all([library.images.read(asset.id,true),library.images.read(asset.id,true)]),[png,png]);
  assert.equal(renders,2,'one rebuild for concurrent reads');
  await writeFile(thumbnail,'broken cache');assert.deepEqual(await library.images.read(asset.id,true),png);assert.equal(renders,3);
  assert.deepEqual(await readFile(library.imagePath(asset.id)),project);assert.deepEqual(await readFile(join(root,'images','index.json')),index);
  await unlink(thumbnail);await writeFile(original,Buffer.alloc(png.length));
  await assert.rejects(library.images.read(asset.id,true),/素材已损坏/);assert.equal(renders,3);
  await writeFile(original,png);await link(original,thumbnail);
  await assert.rejects(library.images.read(asset.id,true),/位置已变化/);assert.deepEqual(await readFile(original),png);
  await unlink(thumbnail);
  const preview=library.images.read(asset.id,true),remove=library.removeImage(asset.id);
  assert.deepEqual(await preview,png);await remove;
  assert.deepEqual(await readdir(join(root,'images')),['index.json']);
  await assert.rejects(library.images.read(asset.id,true),/素材不存在/);
}));

async function recordingSample(root:string){
  const media=new RecordingFile(root,undefined,'wav');await media.create();
  const wave=Buffer.alloc(44+960);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);wave.writeUInt32LE(48000,24);wave.writeUInt32LE(192000,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(960,40);
  await media.append(0,wave);await media.finish();
  const playback={...defaultPlayback(),speed:1.5,system:.4};
  const project={format:'one-recording' as const,version:1 as const,seconds:.005,options:{mode:'audio' as const,container:'wav' as const,sourceId:'',systemAudio:true,microphone:false,microphoneId:'',fps:30,maxWidth:1920},playback,inputs:[],annotations:[],layouts:[]};
  const item={id:randomUUID(),title:'待完成归档',created:Date.now(),seconds:.005,bytes:wave.length,mode:'audio' as const};
  return {media,project,item,playback,save:(path:string)=>saveRecordingProject(path,project,[{kind:'screen',file:media}],()=>true)};
}

test('A complete One recording survives a failed index commit and is published once on restart with its original playback',()=>fixture(async root=>{
  const sample=await recordingSample(root),library=new MaterialLibrary(join(root,'materials'),()=>png);await library.init();
  const folder=join(library.directory,'recordings',sample.item.id),state=join(folder,'state.json'),journal=join(folder,'pending.json'),project=join(folder,'project.onerec');
  try{
    await mkdir(state,{recursive:true});
    await assert.rejects(library.addRecording(sample.item,sample.save,sample.playback));
    assert.deepEqual(library.list(),[]);
    const before=await readFile(project),hash=createHash('sha256').update(before).digest('hex');
    const pending=await readFile(journal);assert.equal(JSON.parse(pending.toString()).format,'one-recording-material-pending');
    await rmdir(state);
    const restarted=new MaterialLibrary(library.directory,()=>png);await restarted.init();await restarted.init();
    assert.deepEqual(restarted.list(),[sample.item]);assert.deepEqual(await restarted.playback(sample.item.id),sample.playback);
    assert.equal(createHash('sha256').update(await readFile(project)).digest('hex'),hash);
    await assert.rejects(readFile(journal),{code:'ENOENT'});
    // A leftover pending marker from a successful commit cannot resurrect a subsequent deletion.
    await writeFile(journal,pending);await restarted.removeRecording(sample.item.id);
    await assert.rejects(readFile(journal),{code:'ENOENT'});
    // Model a failed final file deletion: unindexed media with no pending transaction stays unlisted.
    await writeFile(project,before);
    const afterDelete=new MaterialLibrary(library.directory,()=>png);await afterDelete.init();assert.deepEqual(afterDelete.list(),[]);
    assert.deepEqual(await readFile(project),before);
  }finally{await sample.media.dispose();}
}));

test('Recovery rejects corrupt originals and foreign journals, preserving unfinished files without blocking valid materials',()=>fixture(async root=>{
  const sample=await recordingSample(root),library=new MaterialLibrary(join(root,'materials'),()=>png);await library.init();
  const image=await library.images.add(png,'still available','file');
  const folder=join(library.directory,'recordings',sample.item.id),state=join(folder,'state.json'),journal=join(folder,'pending.json'),project=join(folder,'project.onerec');
  try{
    await mkdir(state,{recursive:true});await assert.rejects(library.addRecording(sample.item,sample.save,sample.playback));await rmdir(state);
    const original=await readFile(project),pending=await readFile(journal),corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=0xff;await writeFile(project,corrupt);
    const restarted=new MaterialLibrary(library.directory,()=>png);await restarted.init();assert.deepEqual(restarted.list(),[]);assert.deepEqual(restarted.images.list(),[image]);
    assert.deepEqual(await readFile(project),corrupt);assert.deepEqual(await readFile(journal),pending);
    await writeFile(project,original);const foreign=JSON.parse(pending.toString());foreign.format='frame-recording';await writeFile(journal,JSON.stringify(foreign));
    await restarted.init();assert.deepEqual(restarted.list(),[]);assert.deepEqual(await readFile(project),original);
    await writeFile(journal,pending);await restarted.init();assert.deepEqual(restarted.list(),[sample.item]);
  }finally{await sample.media.dispose();}
}));

test('Retrying an interrupted recording commit reuses its complete project and updates playback without duplicating media',()=>fixture(async root=>{
  const sample=await recordingSample(root),library=new MaterialLibrary(join(root,'materials'),()=>png);await library.init();
  const folder=join(library.directory,'recordings',sample.item.id),state=join(folder,'state.json');
  try{
    await mkdir(state,{recursive:true});await assert.rejects(library.addRecording(sample.item,sample.save,sample.playback));await rmdir(state);
    const before=await readFile(join(folder,'project.onerec')),playback={...sample.playback,speed:2};
    await library.addRecording(sample.item,async()=>assert.fail('a complete original must not be rewritten on retry'),playback);
    assert.deepEqual(library.list(),[sample.item]);assert.deepEqual(await library.playback(sample.item.id),playback);
    assert.deepEqual(await readFile(join(folder,'project.onerec')),before);
    await library.init();assert.deepEqual(library.list(),[sample.item]);assert.deepEqual(await library.playback(sample.item.id),playback);
  }finally{await sample.media.dispose();}
}));

test('Failed image index commit rolls back all new material files and retains the previous index and originals',()=>fixture(async root=>{
  const library=new MaterialLibrary(root,()=>png);await library.init();const first=await library.images.add(png,'first','file');
  const folder=join(root,'images'),index=join(folder,'index.json'),saved=await readFile(index);
  await rename(index,index+'.held');await mkdir(index);
  await assert.rejects(library.images.add(png,'rejected','clipboard'));
  assert.deepEqual(library.images.list(),[first]);assert.deepEqual(await library.images.read(first.id),png);
  assert.deepEqual((await readdir(folder)).filter(name=>name.endsWith('.oneimage')),[first.id+'.oneimage']);
  assert.equal((await readdir(folder)).some(name=>name.endsWith('.next')),false);
  await rmdir(index);await rename(index+'.held',index);assert.deepEqual(await readFile(index),saved);
  const next=await library.images.add(png,'retry','clipboard');assert.equal(library.images.list().length,2);
  await writeFile(join(folder,next.id+'.png'),Buffer.alloc(png.length));await assert.rejects(library.images.read(next.id),/已损坏/);
  const broken=JSON.parse(saved.toString());broken.format='frame-assets';await writeFile(index,JSON.stringify(broken));
  await assert.rejects(new MaterialLibrary(root,()=>png).init(),/索引损坏/);
}));

test('Recording materials validate One projects, preserve playback updates, ignore uncommitted files and never adopt old products',()=>fixture(async root=>{
  const library=new MaterialLibrary(join(root,'materials'),()=>png);await library.init();
  const media=new RecordingFile(root,undefined,'wav');await media.create();
  const wave=Buffer.alloc(44+960);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);wave.writeUInt32LE(48000,24);wave.writeUInt32LE(192000,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(960,40);
  await media.append(0,wave);await media.finish();
  const playback=defaultPlayback(),id=randomUUID(),item={id,title:'录音素材',created:Date.now(),seconds:.005,bytes:wave.length,mode:'audio' as const};
  const project={format:'one-recording' as const,version:1 as const,seconds:.005,options:{mode:'audio' as const,container:'wav' as const,sourceId:'',systemAudio:true,microphone:false,microphoneId:'',fps:30,maxWidth:1920},playback,inputs:[],annotations:[],layouts:[]};
  try{
    await library.addRecording(item,path=>saveRecordingProject(path,project,[{kind:'screen',file:media}],()=>true),playback);
    assert.ok(library.recordingPath(id).endsWith('project.onerec'));
    assert.equal((await recordingProjectInfo(library.recordingPath(id))).format,'one-recording');
    await assert.rejects(library.addRecording(item,async()=>assert.fail('duplicate write')),/已存在/);
    const changed={...playback,speed:1.5,left:.5,system:.25,microphone:1.8};await library.updateRecording(id,changed);await library.saveRecordingThumbnail(id,png);
    const failed=randomUUID();await assert.rejects(library.addRecording({...item,id:failed},async path=>{await writeFile(path,'incomplete');throw Error('cancelled');}),/cancelled/);
    await writeFile(join(library.directory,'legacy.framerec'),'old file');
    const reopened=new MaterialLibrary(library.directory,()=>png);await reopened.init();await reopened.init();
    assert.deepEqual(reopened.list(),[item]);assert.deepEqual(await reopened.playback(id),changed);assert.deepEqual(await reopened.recordingThumbnail(id),png);
    const marker=JSON.parse(await readFile(join(library.directory,'recordings',id,'state.json'),'utf8'));assert.equal(marker.format,MATERIAL_INDEX_FORMAT.recording);
    await reopened.removeRecording(id);assert.deepEqual(reopened.list(),[]);
    assert.equal(await readFile(join(library.directory,'recordings',failed,'project.onerec'),'utf8'),'incomplete');
  }finally{await media.dispose();}
}));
