import { imageDimensions, IMAGE_BYTES } from './image-limits';
export const FRAME_PNG_LIMIT = IMAGE_BYTES;
export interface NativeFrameInfo {
  backend: 'wgc' | 'gdi';
  width: number;
  height: number;
  bytes: number;
  elapsed: number;
}
/** A bounded header followed by exactly one PNG; binary chunks may split anywhere. */
export class NativeFrameReader {
  private header = Buffer.alloc(0);
  private png?: Buffer;
  private offset = 0;
  info?: NativeFrameInfo;
  get complete() {
    return !!this.info && this.offset === this.info.bytes;
  }
  append(chunk: Buffer) {
    if (!this.info) {
      const end = chunk.indexOf(10);
      if (this.header.length + (end < 0 ? chunk.length : end) > 512)
        throw Error('原生采集响应头过大');
      this.header = Buffer.concat([this.header, end < 0 ? chunk : chunk.subarray(0, end)]);
      if (end < 0) return;
      const value = JSON.parse(this.header.toString('utf8')) as NativeFrameInfo;
      imageDimensions(value.width, value.height);
      if (
        !['wgc', 'gdi'].includes(value.backend) ||
        ![value.width, value.height, value.bytes, value.elapsed].every(Number.isSafeInteger) ||
        value.width < 2 ||
        value.height < 2 ||
        value.bytes < 24 ||
        value.bytes > FRAME_PNG_LIMIT ||
        value.elapsed < 0 ||
        value.elapsed > 12000
      )
        throw Error('原生采集响应无效');
      this.info = value;
      this.header = Buffer.alloc(0);
      this.png = Buffer.allocUnsafe(value.bytes);
      chunk = chunk.subarray(end + 1);
    }
    if (this.offset + chunk.length > this.info.bytes) throw Error('原生采集返回额外数据');
    chunk.copy(this.png!, this.offset);
    this.offset += chunk.length;
  }
  finish() {
    if (!this.info || this.offset !== this.info.bytes || !this.png)
      throw Error('原生采集图像不完整');
    const png = this.png;
    if (
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.toString('ascii', 12, 16) !== 'IHDR' ||
      png.readUInt32BE(16) !== this.info.width ||
      png.readUInt32BE(20) !== this.info.height
    )
      throw Error('原生采集 PNG 尺寸不符');
    return { info: this.info, png };
  }
}
