import {q} from './ui';
import './color.css';

/** The transparent surface owns input without covering the desktop image. */
export function renderColorFreeze(){
  document.documentElement.classList.add('transparent-root');
  document.body.className='color-freeze-window';
  q('app').innerHTML='<main id="color-freeze-surface" aria-label="冻结取色"></main>';
}
