import sharp from 'sharp';
import { IMAGE_BYTES,IMAGE_PIXELS } from '../../shared/capture/image-limits';
import { planOCRTiles,type OCRTile } from '../../shared/recognition/ocr-tiles';
let input:Buffer|undefined,tiles:OCRTile[]=[],next=0,busy=false,peakRSS=0;
sharp.cache(false);sharp.concurrency(1);
const send=(value:unknown)=>{if(process.connected)process.send?.(value);};
function observeMemory(){peakRSS=Math.max(peakRSS,process.memoryUsage().rss);if(peakRSS>384*1024**2){send({error:'长图解码超过内存预算，输入已保留'});process.exit(70);}}
const memory=setInterval(observeMemory,100);memory.unref();
process.on('message',async(packet:any)=>{
  if(busy){send({error:'长图解码请求重叠'});return;}busy=true;
  try{
    if(packet?.type==='open'&&!input){
      if(!Buffer.isBuffer(packet.png)||packet.png.length<33||packet.png.length>IMAGE_BYTES)throw Error('长图数据无效');
      const source:Buffer=packet.png;input=source;tiles=planOCRTiles(packet.size);
      // Interlaced PNG cannot provide top-to-bottom bounded decoding.
      if(source[28]!==0)throw Error('交错 PNG 长图请先转换为普通 PNG 后识别');
      const info=await sharp(source,{limitInputPixels:IMAGE_PIXELS,sequentialRead:true,failOn:'error'}).metadata();
      if(info.format!=='png'||info.width!==packet.size.width||info.height!==packet.size.height||info.pages&&info.pages>1)throw Error('长图尺寸或格式不一致');
      send({ready:true});
    }else if(packet?.type==='next'&&input&&packet.index===next&&tiles[next]){
      const tile=tiles[next++],{left,top,width,height}=tile;
      const png=await sharp(input,{limitInputPixels:IMAGE_PIXELS,sequentialRead:true,failOn:'error'})
        .extract({left,top,width,height}).png({progressive:false}).toBuffer();
      observeMemory();
      if(process.connected)process.send?.({index:tile.index,png,peakRSSMiB:peakRSS/1024**2},()=>png.fill(0));else png.fill(0);
    }else throw Error('长图解码协议无效');
  }catch(error){send({error:error instanceof Error?error.message:'长图解码失败'});}
  finally{busy=false;}
});
process.once('disconnect',()=>{input?.fill(0);process.exit();});
