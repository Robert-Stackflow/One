/** Adapted from pix2tex 0.1.4, Copyright (c) 2021 Lukas Blecher.
 * MIT notice: assets/licenses/pix2tex-LICENSE.txt.
 */
import sharp from 'sharp';
import {FORMULA_IMAGE} from '../../shared/recognition/formula';
import {formulaGrayResize} from './formula-resample';

export interface PixGray {data:Uint8Array;width:number;height:number}
const maxPixels=4_718_592,f32=Math.fround;
function dimensions(image:PixGray){if(![image.width,image.height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=8192)||image.width*image.height>maxPixels||image.data.length!==image.width*image.height)throw Error('公式图片尺寸无效');}
/** Official contrast/polarity, foreground bounding box and white 32px padding. */
export function pix2texPad(image:PixGray):PixGray {
  dimensions(image);let low=255,high=0,total=0;
  for(const value of image.data){low=Math.min(low,value);high=Math.max(high,value);total+=value;}
  if(high===low)throw Error('未检测到可识别的公式笔画');
  const range=high-low,invert=(total/image.data.length-low)/range*255<=128;
  let left=image.width,top=image.height,right=0,bottom=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const value=(image.data[y*image.width+x]-low)/range*255;if(invert?value>128:value<128){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}}
  if(right<=left||bottom<=top)throw Error('未检测到可识别的公式笔画');
  const width=Math.ceil((right-left)/32)*32,height=Math.ceil((bottom-top)/32)*32;
  if(width*height>maxPixels)throw Error('公式区域过大，请裁剪后识别');
  const data=new Uint8Array(width*height);data.fill(255);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const value=(image.data[y*image.width+x]-low)/range*255;data[(y-top)*width+x-left]=Math.max(0,Math.min(255,Math.trunc(f32(invert?255-value:value))));}
  return {data,width,height};
}
// NumPy/Python positive floating floor-divide uses fmod before rounding the quotient.
const floorDivide=(value:number,divisor:number)=>{const divided=(value-value%divisor)/divisor,base=Math.floor(divided);return base+(divided-base>.5?1:0);};
export function pix2texSize(image:PixGray):PixGray {
  dimensions(image);let current:PixGray={...image,data:image.data.slice()};
  try{
    const ratio=Math.max(current.width/672,current.height/192);
    if(ratio>1){const width=floorDivide(current.width,ratio),height=floorDivide(current.height,ratio);if(width<1||height<1)throw Error('公式区域过于狭长，请分段裁剪后识别');const data=formulaGrayResize(current.data,current.width,current.height,width,height,'linear');current.data.fill(0);current={data,width,height};}
    if(current.width<32||current.height<32){
      let left=current.width,top=current.height,right=0,bottom=0;for(let y=0;y<current.height;y++)for(let x=0;x<current.width;x++)if(current.data[y*current.width+x]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
      if(right-left!==current.width||bottom-top!==current.height)throw Error('公式区域过于狭长，请扩大裁剪范围');
      const width=Math.max(32,current.width),height=Math.max(32,current.height),data=new Uint8Array(width*height);data.fill(255);for(let y=0;y<current.height;y++)data.set(current.data.subarray(y*current.width,(y+1)*current.width),y*width);current.data.fill(0);current={data,width,height};
    }
    return current;
  }catch(error){current.data.fill(0);throw error;}
}
export function pix2texTensor(image:PixGray){
  dimensions(image);const mean=f32(f32(.7931)*255),scale=f32(1/f32(f32(.1738)*255)),output=new Float32Array(image.data.length);
  for(let i=0;i<output.length;i++)output[i]=f32(f32(image.data[i]-mean)*scale);return output;
}
export function pix2texResize(image:PixGray,width:number,height:number,enlarge:boolean):PixGray {
  dimensions(image);return {data:formulaGrayResize(image.data,image.width,image.height,width,height,enlarge?'linear':'lanczos'),width,height};
}
export async function pix2texInput(png:Buffer):Promise<PixGray>{
  if(png.length<24||png.length>FORMULA_IMAGE||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('公式图片支持最多 8 MiB PNG');
  const {data,info}=await sharp(png,{limitInputPixels:4_194_304}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const gray=new Uint8Array(info.width*info.height);let padded:PixGray|undefined;
  try{
    if(info.channels!==4||Math.max(info.width,info.height)>8192)throw Error('公式图片尺寸无效');
    let varyingAlpha=false;for(let at=3;at<data.length;at+=4)if(data[at]!==data[3]){varyingAlpha=true;break;}
    for(let i=0;i<gray.length;i++){const at=i*4;gray[i]=varyingAlpha?255-data[at+3]:(data[at]*19595+data[at+1]*38470+data[at+2]*7471+32768)>>16;}
    padded=pix2texPad({data:gray,width:info.width,height:info.height});return pix2texSize(padded);
  }finally{data.fill(0);gray.fill(0);padded?.data.fill(0);}
}
