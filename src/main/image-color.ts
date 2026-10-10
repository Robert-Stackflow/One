import {stat} from 'node:fs/promises';
import sharp from 'sharp';
import type {ImageColorPreview,ImagePixelSample} from '../shared/image-color';

sharp.cache({files:0});

async function source(path:string){
 const info=await stat(path);if(!info.isFile()||info.size>100*1024*1024)throw Error('图片文件无效或超过 100 MB');
 const metadata=await sharp(path,{pages:1,limitInputPixels:50_000_000,failOn:'error'}).metadata();
 if(!metadata.width||!metadata.height||!['png','jpeg','webp','gif','tiff'].includes(metadata.format||''))throw Error('暂不支持该图片编码');
 const swapped=[5,6,7,8].includes(metadata.orientation||1);
 return {width:swapped?metadata.height:metadata.width,height:swapped?metadata.width:metadata.height,pages:metadata.pages||1,format:metadata.format||''};
}
export async function imageColorPreview(path:string):Promise<ImageColorPreview>{
 const info=await source(path),bytes=await sharp(path,{pages:1,limitInputPixels:50_000_000,failOn:'error'}).rotate().resize({width:960,height:640,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 return {...info,url:`data:image/png;base64,${bytes.toString('base64')}`};
}
export async function imageColorSample(path:string,x:unknown,y:unknown):Promise<ImagePixelSample>{
 const info=await source(path);if(!Number.isInteger(x)||!Number.isInteger(y)||Number(x)<0||Number(y)<0||Number(x)>=info.width||Number(y)>=info.height)throw Error('取色坐标超出图片范围');
 const pixel=await sharp(path,{pages:1,limitInputPixels:50_000_000,failOn:'error'}).rotate().extract({left:Number(x),top:Number(y),width:1,height:1}).toColourspace('srgb').ensureAlpha().raw().toBuffer();
 const alpha=pixel[3]/255,channels=[0,1,2].map(index=>Math.round(pixel[index]*alpha+255*(1-alpha)));
 const hex='#'+channels.map(channel=>channel.toString(16).padStart(2,'0')).join('').toUpperCase();
 return {hex,alpha:Math.round(alpha*100),x:Number(x),y:Number(y)};
}
