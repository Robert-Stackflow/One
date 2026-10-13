import markup from './recognition/markup.html?raw';
import {q} from './ui';
import {windowControls,setupChrome} from './chrome';
import {mountOCR} from './recognition/ocr';
export async function renderRecognition(){
  document.body.dataset.view='recognition';q('app').innerHTML=markup;
  document.querySelector('.media-header')!.insertAdjacentHTML('beforeend',windowControls());setupChrome();
  mountOCR();
}
