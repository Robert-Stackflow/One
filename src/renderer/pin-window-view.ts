import {q} from './ui';
export async function renderPinWindow(controls:boolean){
  document.body.dataset.view=controls?'pin-controls':'pin';document.body.classList.toggle('pin-controls',controls);
  q('app').innerHTML=controls?'<main id="pin-tools"></main>':'<main id="pin-stage"><div id="pin-content"></div></main>';
  q('app').insertAdjacentHTML('beforeend','<div id="toast" role="status" aria-live="polite" hidden></div>');
  await import('./pins/pin');
}
