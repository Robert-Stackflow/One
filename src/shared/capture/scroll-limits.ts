import { IMAGE_EDGE, IMAGE_PIXELS } from './image-limits';

// Capture frames and editor canvases keep their existing limits. Only the
// disk-backed stitched result uses this larger, independent capacity.
export const SCROLL_PIXELS = 160_000_000;
export const SCROLL_EDGE = 131072;
export const SCROLL_DISK_BYTES = 768 * 1024 * 1024;
export const SCROLL_CLIPBOARD_BYTES = 128 * 1024 * 1024;
export const SCROLL_THUMBNAIL_BYTES = 24 * 1024 * 1024;
export function scrollDimensions(width:number,height:number){
  if(![width,height].every(Number.isSafeInteger)||width<1||height<1||width>SCROLL_EDGE||height>SCROLL_EDGE||width*height>SCROLL_PIXELS)
    throw Error('长截图支持最多 1.6 亿像素、最长边 131,072 像素');
  return {width,height};
}
export function scrollEditSize(width:number,height:number){
  scrollDimensions(width,height);
  const scale=Math.min(1,IMAGE_EDGE/width,IMAGE_EDGE/height,Math.sqrt(IMAGE_PIXELS/(width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scaled:scale<1};
}
