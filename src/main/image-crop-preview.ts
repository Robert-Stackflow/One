import {stat} from 'node:fs/promises';
import sharp from 'sharp';
import type {ImageCropPreview} from '../shared/image-convert';

export async function imageCropPreview(path:string):Promise<ImageCropPreview>{
 const info=await stat(path);if(!info.isFile()||info.size>100*1024*1024)throw Error('图片文件无效或超过 100 MB');
 const pipeline=sharp(path,{pages:1,limitInputPixels:50_000_000,failOn:'error'}),metadata=await pipeline.metadata();
 if(!metadata.width||!metadata.height||!['png','jpeg','webp','gif','tiff'].includes(metadata.format||''))throw Error('暂不支持该图片编码');
 if((metadata.pages||1)>1)throw Error('裁剪暂不支持动图或多页图片');
 const swapped=[5,6,7,8].includes(metadata.orientation||1),width=swapped?metadata.height:metadata.width,height=swapped?metadata.width:metadata.height;
 const bytes=await pipeline.rotate().resize({width:960,height:640,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 return {url:`data:image/png;base64,${bytes.toString('base64')}`,width,height,format:metadata.format||''};
}
