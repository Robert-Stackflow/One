import markup from './recording/recording-player.html?raw';
import {windowControls,setupChrome} from './chrome';
import {customControls} from './controls';
import {setupColorControls} from './color-picker';

export async function renderRecordingPlayer(){
  document.body.dataset.view='recording-player';
  document.body.classList.add('recording-player-page');
  const root=document.getElementById('app')!;
  root.innerHTML=markup;
  root.querySelector('.media-header')!.insertAdjacentHTML('beforeend',windowControls());
  setupChrome();
  await import('./recording/recording-player');
  document.querySelectorAll('.editor-popover').forEach(panel=>panel.classList.add('one-popover'));
  customControls(root);
  setupColorControls(root);
}

export async function renderRecordingExport(){
  document.body.dataset.view='recording-export';
  await import('./recording/recording-export');
}
