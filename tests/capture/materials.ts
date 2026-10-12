import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,rmdir,realpath,rename} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
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
