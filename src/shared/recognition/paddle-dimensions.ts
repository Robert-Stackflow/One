/** Shared by dispatch and tensor preparation so capacity is checked after the exact model resize. */
export const PADDLE_DETECTION_PIXELS=4_000_000,PADDLE_TILE_EDGE=1984;
export function paddleDetectionDimensions(size:{width:number;height:number},resizeLong?:number,minSide=736,maxSide=4000){
  const {width,height}=size;
  if(![width,height].every(Number.isSafeInteger)||width<1||height<1||width>16384||height>16384||width*height>40_000_000)throw Error('OCR 检测图像无效');
  if(![minSide,maxSide].every(Number.isSafeInteger)||minSide<32||maxSide<minSide||maxSide>4000||resizeLong!==undefined&&(!Number.isSafeInteger(resizeLong)||resizeLong<128||resizeLong>3968))throw Error('OCR 检测缩放配置无效');
  const ratio=resizeLong===undefined?Math.min(Math.max(1,minSide/Math.min(width,height)),maxSide/Math.max(width,height)):resizeLong/Math.max(width,height);
  const side=(value:number)=>resizeLong===undefined?Math.max(32,Math.round(Math.floor(value*ratio)/32)*32):Math.max(128,Math.ceil(Math.floor(value*ratio)/128)*128);
  return {width:side(width),height:side(height)};
}
export function paddleDetectionTiles(size:{width:number;height:number},resizeLong?:number){
  const normalized=paddleDetectionDimensions(size,resizeLong);
  return {forceTiles:normalized.width*normalized.height>PADDLE_DETECTION_PIXELS,tileEdge:resizeLong===undefined?PADDLE_TILE_EDGE:2048};
}
