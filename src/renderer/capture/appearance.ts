import {captureScales,type CapturePreferences} from '../../shared/capture/settings';

type Scale=CapturePreferences['uiScale'];
const inherited=new WeakMap<HTMLElement,{scale:string|undefined;styles:[string,string,string][]}>();
const properties=['--text-scale','--control-font','font-size'];

/** Only the feature container changes; One remains the sole font/theme source. */
export function applyCaptureScale(root:HTMLElement,scale:Scale){
  if(!captureScales.includes(scale))throw Error('截图与录制缩放无效');
  root.dataset.captureScale=String(scale);
  root.style.setProperty('--text-scale',String(scale/100));
  root.style.setProperty('--control-font','calc(13px * var(--text-scale))');
  root.style.fontSize='var(--control-font)';
  root.dispatchEvent(new CustomEvent('one:capture-scale',{bubbles:true}));
}

/** A top-layer portal inherits its owning feature's text scale, without a second theme. */
export function inheritCaptureScale(anchor:HTMLElement,popup:HTMLElement){
  const owner=anchor.closest<HTMLElement>('[data-capture-scale]');
  const scale=Number(owner?.dataset.captureScale) as Scale;
  if(owner&&captureScales.includes(scale)){
    if(!inherited.has(popup))inherited.set(popup,{scale:popup.dataset.captureScale,styles:properties.map(name=>[name,popup.style.getPropertyValue(name),popup.style.getPropertyPriority(name)])});
    if(popup.dataset.captureScale!==String(scale))applyCaptureScale(popup,scale);
  }else{
    const previous=inherited.get(popup);if(!previous)return;
    for(const [name,value,priority] of previous.styles){if(value)popup.style.setProperty(name,value,priority);else popup.style.removeProperty(name);}
    if(previous.scale===undefined)delete popup.dataset.captureScale;else popup.dataset.captureScale=previous.scale;
    inherited.delete(popup);
  }
}
