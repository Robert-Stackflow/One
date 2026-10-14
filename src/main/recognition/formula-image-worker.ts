import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {formulaCrop,FORMULA_PNG_BYTES} from '../../shared/recognition/formula-image';
import {formulaText} from '../../shared/recognition/formula';
import {IMAGE_BYTES,IMAGE_PIXELS} from '../../shared/capture/image-limits';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
sharp.concurrency(1);sharp.cache({memory:32,files:0,items:16});
process.once('message',async(job:{kind:'crop'|'render';png?:Buffer;crop?:unknown;text?:string})=>{
  try{
    if(job.kind==='crop'){
      if(!Buffer.isBuffer(job.png)||job.png.length>IMAGE_BYTES||job.png.length<24||!job.png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('裁剪图片无效');
      const source=sharp(job.png,{limitInputPixels:IMAGE_PIXELS}),size=await source.metadata();if(!size.width||!size.height)throw Error('裁剪图片尺寸无效');
      const crop=formulaCrop(job.crop,{width:size.width,height:size.height}),{data,info}=await source.extract(crop.region).rotate(crop.rotation*90).png().toBuffer({resolveWithObject:true});
      if(data.length>FORMULA_PNG_BYTES)throw Error('裁剪结果超过 8 MiB，请缩小区域');
      process.send?.({ok:true,kind:'crop',sha256:hash(job.png),png:data,width:info.width,height:info.height});
    }else if(job.kind==='render'){
      const text=formulaText(job.text),{formulaVector}=await import('./formula-vector'),vector=formulaVector(text);
      const png=await sharp(Buffer.from(vector.svg),{limitInputPixels:8_000_000}).flatten({background:'#ffffff'}).png().toBuffer();if(png.length>FORMULA_PNG_BYTES)throw Error('公式图片超过 8 MiB，请分段导出');
      process.send?.({ok:true,kind:'render',sha256:hash(text),...vector,png});
    }else throw Error('公式图片任务无效');
  }catch(error){process.send?.({ok:false,error:error instanceof Error?error.message.slice(0,300):'公式图像处理失败'});}
  finally{job.png?.fill(0);process.disconnect?.();}
});
