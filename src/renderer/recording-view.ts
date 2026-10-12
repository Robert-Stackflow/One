import markup from './recording/markup.html?raw';
import './recording-view.css';
import './audio-level.css';
export {setupRecording} from './recording/controller';
export const recordingPage=()=>markup;
export const recordingHeadingActions=()=>'<button type="button" id="recording-start" class="primary" disabled>开始录制</button>';
