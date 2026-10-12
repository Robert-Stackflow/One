import markup from './capture/markup.html?raw';
import {q} from './ui';
export async function renderCapture(){
  document.body.dataset.view='capture';q('app').innerHTML=markup;
  await import('./capture/capture');
}
