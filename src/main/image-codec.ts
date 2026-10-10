import sharp from 'sharp';
import type {ImageCodecCapabilities} from '../shared/image-codec';

let cached:Promise<ImageCodecCapabilities>|undefined;
export function imageCodecCapabilities():Promise<ImageCodecCapabilities>{
 return cached??=Promise.resolve().then(async()=>({
  heicRead:Boolean(sharp.format.heif?.input.fileSuffix?.some(suffix=>suffix==='.heic'||suffix==='.heif')),
  heicWrite:await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).heif({compression:'hevc'}).toBuffer().then(()=>true,()=>false)
 }));
}
