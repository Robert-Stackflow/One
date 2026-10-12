import markup from './editor/markup.html?raw';
import './editor/layout.css';
import './editor/window.css';
import {windowControls,setupChrome} from './chrome';
import {confirmDialog} from './dialog';
import {closeControls} from './controls';
import {closeCaptureMenu} from './editor/capture-menu';
import {api,q} from './ui';
export async function renderImageEditor(){
  document.body.dataset.view='image-editor';
  q('app').innerHTML=markup;
  document.querySelector('.media-header')!.insertAdjacentHTML('beforeend',windowControls());
  setupChrome();
  api.imageEditor!.onCloseRequest(async token=>{
    closeControls();closeCaptureMenu();
    const accepted=await confirmDialog({title:'关闭图片编辑',message:'放弃尚未保存的图片修改？',confirm:'放弃并关闭',danger:true});
    await api.imageEditor!.answerClose(token,accepted);
  });
  await import('./editor/image-editor');
}
