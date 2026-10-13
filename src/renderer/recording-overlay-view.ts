import input from './recording/recording-input-overlay.html?raw';
import camera from './recording/recording-camera-overlay.html?raw';
import annotation from './recording/recording-annotation-overlay.html?raw';
import region from './recording/recording-region-overlay.html?raw';
import countdown from './recording/recording-countdown.html?raw';

export async function renderRecordingOverlay(view:string){
  document.body.dataset.view=view;
  const app=document.getElementById('app')!;
  switch(view){
    case 'recording-input-overlay':app.innerHTML=input;await import('./recording/recording-input-overlay');break;
    case 'recording-camera-overlay':app.innerHTML=camera;await import('./recording/recording-camera-overlay');break;
    case 'recording-annotation-overlay':app.innerHTML=annotation;await import('./recording/recording-annotation-overlay');break;
    case 'recording-region-overlay':
    case 'recording-region-outline':app.innerHTML=region;await import('./recording/recording-region-overlay');break;
    case 'recording-countdown':app.innerHTML=countdown;await import('./recording/recording-countdown');break;
    default:throw Error('未知录制浮层');
  }
}
