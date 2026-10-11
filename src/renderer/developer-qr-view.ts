import './developer-qr.css';
import {api,q,toast,errorMessage} from './ui';
import type {QrRequest,QrErrorLevel} from '../shared/developer-qr';
import {toolInfo} from './tool-page-components';

export function developerQrPage(){return `<div class="developer-qr-page">
 <div class="developer-qr-layout"><section class="settings-card developer-qr-panel" aria-label="二维码设置"><div class="tool-card-head"><h3>内容与尺寸</h3>${toolInfo('二维码输入限制','输入最多 2048 字节；尺寸和纠错级别改变后会自动重新生成。')}</div>
 <label class="developer-qr-input">内容<textarea id="developer-qr-text" spellcheck="false" maxlength="2048" placeholder="输入要编码的文本或链接"></textarea></label>
 <div class="developer-qr-options"><label>图片尺寸<select id="developer-qr-size"><option value="256">256 × 256</option><option value="512" selected>512 × 512</option><option value="1024">1024 × 1024</option></select></label><label>纠错级别<select id="developer-qr-level"><option value="L">低 L</option><option value="M" selected>中 M</option><option value="Q">较高 Q</option><option value="H">高 H</option></select></label></div>
 </section>
 <section class="settings-card developer-qr-panel" aria-label="二维码预览"><div class="tool-card-head developer-qr-result-head"><h3>预览</h3><div class="developer-qr-actions"><button id="developer-qr-copy" type="button" disabled>复制图片</button><button id="developer-qr-export" type="button" disabled>导出 PNG</button></div></div><div class="developer-qr-preview"><img id="developer-qr-image" alt="生成的二维码" hidden><p id="developer-qr-empty">输入内容后自动预览</p></div><span id="developer-qr-status" role="status" aria-live="polite"></span></section></div></div>`;}

export function setupDeveloperQr(){
 const input=q<HTMLTextAreaElement>('developer-qr-text'),size=q<HTMLSelectElement>('developer-qr-size'),level=q<HTMLSelectElement>('developer-qr-level'),copy=q<HTMLButtonElement>('developer-qr-copy'),exportButton=q<HTMLButtonElement>('developer-qr-export');
 const image=q<HTMLImageElement>('developer-qr-image'),empty=q<HTMLElement>('developer-qr-empty'),status=q<HTMLElement>('developer-qr-status');let running=false,ready=false,revision=0,timer:ReturnType<typeof setTimeout>|undefined,queued=false;
 const render=()=>{copy.disabled=exportButton.disabled=running||!ready;image.hidden=!ready;empty.hidden=ready;};
 const generate=()=>{timer=undefined;if(!input.value)return;if(running){queued=true;return;}const id=revision,request:QrRequest={text:input.value,size:Number(size.value) as QrRequest['size'],level:level.value as QrErrorLevel};running=true;status.textContent='正在生成…';render();void api.developerQrGenerate(request).then(result=>{if(id!==revision)return;image.src=result.url;ready=true;status.textContent=`已生成 ${result.size} × ${result.size} PNG（${result.bytes} 字节）`;}).catch(error=>{if(id===revision)status.textContent=errorMessage(error);}).finally(()=>{running=false;if(queued){queued=false;generate();}else render();});};
 const schedule=()=>{revision++;if(timer)clearTimeout(timer);ready=false;image.removeAttribute('src');status.textContent='';render();if(input.value)timer=setTimeout(generate,180);};input.oninput=schedule;size.onchange=level.onchange=schedule;
 copy.onclick=()=>void api.developerQrCopy().then(()=>toast('已复制二维码图片')).catch(toast);
 exportButton.onclick=()=>void api.developerQrExport().then(path=>{if(path)status.textContent=`已导出 ${path.split(/[\\/]/).pop()}`;}).catch(toast);
 render();return {activate(_value:boolean){},dispose(){revision++;if(timer)clearTimeout(timer);queued=false;}};
}
