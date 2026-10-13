import markup from './recording/markup.html?raw';
import './recording-view.css';
import './audio-level.css';
import {api} from './ui';
import {setupRecording} from './recording/controller';
export {setupRecording} from './recording/controller';
export const recordingPage=()=>markup;
export const recordingHeadingActions=()=>'<button type="button" id="recording-start" class="primary" disabled>开始录制</button>';
export function setupRecordingPage(root:HTMLElement,heading:HTMLElement){
  const controller=setupRecording(root,heading,api.recording!);
  let disposed=false,revision=0,activation=0;
  const unsubscribe=api.onCapturePreferences(value=>{++revision;if(!disposed)controller.scale(value.uiScale);});
  return {
    async activate(value:boolean){
      if(disposed)return;
      const request=++activation;
      if(value){const current=revision;const settings=await api.settings();if(!disposed&&request===activation&&current===revision)controller.scale(settings.capture.uiScale);}
      if(!disposed&&request===activation)await controller.activate(value);
    },
    async dispose(){disposed=true;++activation;unsubscribe();await controller.dispose();},
  };
}
