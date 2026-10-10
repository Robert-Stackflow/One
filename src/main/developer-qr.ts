import QRCode from 'qrcode';
import type {QrRequest} from '../shared/developer-qr';

export async function generateQr(value:unknown):Promise<Buffer>{
 if(!value||typeof value!=='object')throw Error('二维码设置无效');const request=value as QrRequest;
 if(typeof request.text!=='string'||!request.text||Buffer.byteLength(request.text,'utf8')>2048)throw Error('二维码内容需为 1 至 2048 字节的 UTF-8 文本');
 if(![256,512,1024].includes(request.size)||!['L','M','Q','H'].includes(request.level))throw Error('二维码尺寸或纠错级别无效');
 const png=await QRCode.toBuffer(request.text,{type:'png',errorCorrectionLevel:request.level,margin:4,width:request.size,color:{dark:'#000000',light:'#ffffff'}});
 if(png.length>4*1024*1024)throw Error('二维码图片超过 4 MB 上限');return png;
}
