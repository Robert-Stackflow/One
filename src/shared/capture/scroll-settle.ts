import { imageDimensions } from './image-limits';
import { scrollOptions, type ScrollOptions } from './scroll-capture';
import type { PixelFrame } from './scroll-stitch';

/** Compare the same body coordinates across time, before any frame reaches the
 * stitch model. A small changing column (caret/scrollbar) is tolerated; smooth
 * scrolling and widespread animation keep resetting the quiet interval. */
export class ScrollSettle {
  private options: ScrollOptions;
  private reference?: Uint8Array;
  private since = 0;
  private samples = 0;
  private last = -1;
  private columns: number;
  private rows: number;
  private width: number;
  private height: number;
  constructor(options: ScrollOptions, source: { width: number; height: number }) {
    imageDimensions(source.width, source.height);
    this.options = scrollOptions(options, source.width, source.height);
    this.width = source.width;
    this.height = source.height;
    const vertical = options.axis === 'vertical';
    this.columns = Math.min(
      48,
      (vertical ? source.width : source.height) - options.ignoreStart - options.ignoreEnd,
    );
    this.rows = Math.min(
      96,
      (vertical ? source.height : source.width) - options.trimStart - options.trimEnd,
    );
  }
  reset() {
    this.reference = undefined;
    this.samples = 0;
    this.last = -1;
  }
  observe(frame: PixelFrame, now: number): boolean {
    if (
      frame.width !== this.width ||
      frame.height !== this.height ||
      frame.pixels.byteLength !== this.width * this.height * 4
    )
      throw Error('采集帧尺寸已改变');
    if (!Number.isFinite(now) || now < 0 || now < this.last) throw Error('采集时间无效');
    const vertical = this.options.axis === 'vertical',
      axis = (vertical ? this.height : this.width) - this.options.trimStart - this.options.trimEnd,
      cross =
        (vertical ? this.width : this.height) - this.options.ignoreStart - this.options.ignoreEnd,
      signature = new Uint8Array(this.columns * this.rows * 3);
    for (let x = 0; x < this.columns; x++)
      for (let y = 0; y < this.rows; y++) {
        const a = this.options.trimStart + Math.floor((y * (axis - 1)) / (this.rows - 1)),
          c = this.options.ignoreStart + Math.floor((x * (cross - 1)) / (this.columns - 1)),
          from = (vertical ? a * this.width + c : c * this.width + a) * 4,
          to = (x * this.rows + y) * 3;
        signature.set(frame.pixels.subarray(from, from + 3), to);
      }
    let changed = !this.reference;
    if (this.reference) {
      const errors: number[] = [];
      for (let x = 0; x < this.columns; x++) {
        let difference = 0;
        for (let i = x * this.rows * 3; i < (x + 1) * this.rows * 3; i++)
          difference += Math.abs(this.reference[i] - signature[i]);
        errors.push(difference / (this.rows * 3));
      }
      errors.sort((a, b) => a - b);
      const keep = Math.ceil(errors.length * 0.9);
      changed = errors.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep >= 0.4;
    }
    this.last = now;
    if (changed) {
      this.reference = signature;
      this.since = now;
      this.samples = 1;
      return false;
    }
    // Keep the first signature of the interval, so gradual drift cannot hide
    // behind a series of individually small changes.
    this.samples++;
    return this.samples >= 3 && now - this.since >= 280;
  }
}
