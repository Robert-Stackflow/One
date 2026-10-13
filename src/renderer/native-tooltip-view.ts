import {nativeTooltipMargin} from '../shared/native-tooltip';
import {api} from './ui';
export function renderNativeTooltip(){
 document.documentElement.classList.add('native-tooltip-window');
 const tip=document.createElement('div');tip.className='one-tooltip visible';tip.role='tooltip';document.getElementById('app')!.replaceChildren(tip);
 api.onNativeTooltip(data=>{document.documentElement.dataset.theme=data.theme||'light';const m=nativeTooltipMargin;tip.textContent=data.text;tip.dataset.side=data.side;tip.style.cssText=`left:${m}px;top:${m}px;width:${data.bounds.width}px;height:${data.bounds.height}px;box-sizing:border-box;transition:none;`;tip.style.font=data.font;tip.style.setProperty('--tooltip-arrow',data.arrow+'px');requestAnimationFrame(()=>{void api.nativeTooltipPainted();});});
 void api.nativeTooltipReady();
}
