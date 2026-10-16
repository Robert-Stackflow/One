import { nativeImage, clipboard, ClipboardItem } from 'electron';
import { imageDimensions, IMAGE_BASE64, IMAGE_BYTES } from '../../shared/capture/image-limits';
import {readFile,stat} from 'node:fs/promises';
import {SCROLL_CLIPBOARD_BYTES} from '../../shared/capture/scroll-limits';
export function pngDimensions(value: string) {
  if (
    typeof value !== 'string' ||
    value.length > IMAGE_BASE64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw Error('图片格式无效');
  const header = Buffer.from(value.slice(0, 48), 'base64');
  if (
    header.length < 24 ||
    !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    header.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw Error('图片格式无效');
  return imageDimensions(header.readUInt32BE(16), header.readUInt32BE(20));
}
export function decodePng(value: string) {
  const dimensions = pngDimensions(value),
    data = Buffer.from(value, 'base64');
  if (data.length > IMAGE_BYTES) throw Error('图片文件过大');
  const image = nativeImage.createFromBuffer(data);
  if (
    image.isEmpty() ||
    image.getSize().width !== dimensions.width ||
    image.getSize().height !== dimensions.height
  )
    throw Error('无法解码图片');
  return { data, size: dimensions };
}
export async function readClipboardPng() {
  for (const item of await clipboard.read())
    if (item.types.includes('image/png')) {
      const blob = await item.getType('image/png');
      if (!(blob instanceof Blob) || blob.size > IMAGE_BYTES) throw Error('剪贴板图片过大');
      const png = Buffer.from(await blob.arrayBuffer());
      decodePng(png.toString('base64'));
      return png;
    }
  return null;
}
export async function writeClipboardPng(png: Buffer) {
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
  ]);
}
export async function writeClipboardPngFile(file:string,valid:()=>boolean=()=>true){
  if(!valid())throw Error('复制已取消');
  if((await stat(file)).size>SCROLL_CLIPBOARD_BYTES)throw Error('长截图文件超过剪贴板容量，请另存原图。');
  const png=await readFile(file);
  try{if(png.length>SCROLL_CLIPBOARD_BYTES)throw Error('长截图文件超过剪贴板容量，请另存原图。');if(!valid())throw Error('复制已取消');await writeClipboardPng(png);}finally{png.fill(0);}
}
