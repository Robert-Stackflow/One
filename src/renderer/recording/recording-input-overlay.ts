import './recording-input-overlay.css';
import { drawRecordingInput } from './recording-input';
import type { InputOverlayState } from '../../shared/recording/recording-input-overlay';
const canvas = document.querySelector('canvas')!;
let state: InputOverlayState | undefined,
  at = 0;
function update(value: InputOverlayState) {
  state = value;
  at = performance.now();
  paint();
}
window.one!.recordingInput!.onChange(update);
void window.one!.recordingInput!.state().then(update);
function paint() {
  const w = Math.round(innerWidth * devicePixelRatio),
    h = Math.round(innerHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (state?.style)
    drawRecordingInput(
      canvas,
      state.events,
      state.sample + (state.paused ? 0 : (performance.now() - at) * 48),
      state.style,
      state.width,
      state.height,
    );
}
function draw() {
  paint();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
