import { exposeRecordingWindow, recordingInvoke, recordingListen } from './recording-common';
import type { RecordingCountdownAPI } from '../shared/recording/recording-countdown';
const api: RecordingCountdownAPI = {
  state: () => recordingInvoke('recording-countdown-state'),
  cancel: () => recordingInvoke('recording-countdown-cancel'),
  onTick: callback => recordingListen('recording-countdown-tick', callback),
};
exposeRecordingWindow('recordingCountdown', api);
