import './developer-qr.css';
import {api,q,toast,errorMessage} from './ui';
import type {QrRequest,QrErrorLevel} from '../shared/developer-qr';

export function developerQrPage(){return `<div class="developer-qr-page"><header class="developer-qr-heading"><h2>生成二维码</h2><p>输入文本或链接，在本地生成可复制、导出的 PNG 二维码。</p></header>
 <div class="developer-qr-layout"><section class="settings-card developer-qr-panel" aria-label="二维码设置"><h3>生成设置</h3>
 <label class="developer-qr-input">内容<textarea id="developer-qr-text" spellcheck="false" maxlength="2048" placeholder="输入要编码的文本或链接"></textarea></label>
 <div class="developer-qr-options"><label>图片尺寸<select id="developer-qr-size"><option value="256">256 × 256</option><option value="512" selected>512 × 512</option><option value="1024">1024 × 1024</option></select></label><label>纠错级别<select id="developer-qr-level"><option value="L">低 L</option><option value="M" selected>中 M</option><option value="Q">较高 Q</option><option value="H">高 H</option></select></label></div>
 <div class="developer-qr-actions"><button id="developer-qr-generate" type="button">生成二维码</button><button id="developer-qr-copy" type="button" disabled>复制图片</button><button id="developer-qr-export" type="button" disabled>导出 PNG</button></div><span id="developer-qr-status" role="status" aria-live="polite"></span></section>
 <section class="settings-card developer-qr-panel" aria-label="二维码预览"><h3>预览</h3><div class="developer-qr-preview"><img id="developer-qr-image" alt="生成的二维码" hidden><p id="developer-qr-empty">生成后在这里预览。</p></div></section></div></div>`;}

export function setupDeveloperQr(){
 const input=q<HTMLTextAreaElement>('developer-qr-text'),size=q<HTMLSelectElement>('developer-qr-size'),level=q<HTMLSelectElement>('developer-qr-level'),generate=q<HTMLButtonElement>('developer-qr-generate'),copy=q<HTMLButtonElement>('developer-qr-copy'),exportButton=q<HTMLButtonElement>('developer-qr-export');
 const image=q<HTMLImageElement>('developer-qr-image'),empty=q<HTMLElement>('developer-qr-empty'),status=q<HTMLElement>('developer-qr-status');let running=false,ready=false;
 const render=()=>{for(const field of [input,size,level,generate])field.disabled=running;copy.disabled=exportButton.disabled=running||!ready;image.hidden=!ready;empty.hidden=ready;};
 const clear=()=>{ready=false;image.removeAttribute('src');status.textContent='内容已更改，请重新生成';render();};input.oninput=clear;size.onchange=level.onchange=clear;
 generate.onclick=()=>{if(!input.value){status.textContent='请输入二维码内容';return;}const request:QrRequest={text:input.value,size:Number(size.value) as QrRequest['size'],level:level.value as QrErrorLevel};running=true;ready=false;status.textContent='正在生成…';render();void api.developerQrGenerate(request).then(result=>{image.src=result.url;ready=true;status.textContent=`已生成 ${result.size} × ${result.size} PNG（${result.bytes} 字节）`;}).catch(error=>{status.textContent=errorMessage(error);}).finally(()=>{running=false;render();});};
 copy.onclick=()=>void api.developerQrCopy().then(()=>toast('已复制二维码图片')).catch(toast);
 exportButton.onclick=()=>void api.developerQrExport().then(path=>{if(path)status.textContent=`已导出 ${path.split(/[\\/]/).pop()}`;}).catch(toast);
 render();return {activate(_value:boolean){},dispose(){}};
}
