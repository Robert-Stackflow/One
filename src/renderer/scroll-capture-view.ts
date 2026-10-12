import markup from './capture/scroll-markup.html?raw';
import {api,q} from './ui';
import {windowControls,setupChrome} from './chrome';
import {confirmDialog} from './dialog';
import {closeControls} from './controls';
export async function renderScrollCapture(){
  document.body.dataset.view='scroll-capture';q('app').innerHTML=markup;
  document.querySelector('.media-header')!.insertAdjacentHTML('beforeend',windowControls());setupChrome();
  api.scrollCapture!.onCloseRequest(async token=>{
    closeControls();const accepted=await confirmDialog({title:'退出 One',message:'放弃尚未保存的长截图结果并退出 One？',confirm:'放弃并退出',danger:true});
    await api.scrollCapture!.answerClose(token,accepted);
  });
  await import('./capture/scroll-capture');
}
