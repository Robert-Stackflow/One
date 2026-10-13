import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {ImageHistory} from '../../src/shared/capture/image-document';
import {writeImageProject} from '../../src/main/capture/image-project';
import {RecordingFile} from '../../src/main/recording/recording-file';
import {saveRecordingProject} from '../../src/main/recording/recording-project';
import {defaultPlayback} from '../../src/shared/recording/recording-playback';
import {PNG} from 'pngjs';

export async function createEntryFixtures(root:string){
  const image=join(root,'图片 一.oneimage'),otherImage=join(root,'图片 二.ONEIMAGE');
  const bitmap=new PNG({width:4,height:4});bitmap.data.fill(255);const png=PNG.sync.write(bitmap);
  const history=new ImageHistory(4,4,true);history.commit({...history.value,effects:{...history.value.effects,border:{width:1,color:'#123456'}}});
  await writeImageProject(image,{format:'one-image',version:1,name:'启动 中文 图',document:history.value,history:history.snapshot},png);
  await writeImageProject(otherImage,{format:'one-image',version:1,name:'第二幅图',document:history.value,history:history.snapshot},png);
  const recording=join(root,'录制 一.onerec'),otherRecording=join(root,'录制 二.ONEREC'),corrupt=join(root,'损坏 录制.onerec');
  const media=new RecordingFile(root,undefined,'wav');
  try{
    await media.create();
    const wave=Buffer.alloc(44+19200);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);wave.writeUInt32LE(48000,24);wave.writeUInt32LE(192000,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(19200,40);
    await media.append(0,wave);await media.finish();
    const project={format:'one-recording' as const,version:1 as const,seconds:.1,options:{mode:'audio' as const,container:'wav' as const,sourceId:'',systemAudio:true,microphone:false,microphoneId:'',fps:30,maxWidth:1920},playback:{...defaultPlayback(),speed:1.5},inputs:[],annotations:[],layouts:[]};
    await saveRecordingProject(recording,project,[{kind:'screen',file:media}],()=>true);
    await saveRecordingProject(otherRecording,{...project,playback:{...project.playback,speed:2}},[{kind:'screen',file:media}],()=>true);
  }finally{await media.dispose();}
  await writeFile(corrupt,'not a One recording');
  return {image,otherImage,recording,otherRecording,corrupt};
}
