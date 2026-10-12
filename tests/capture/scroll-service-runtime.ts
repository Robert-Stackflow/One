// Build-time aliases used only by the Node session tests. No desktop windows,
// cursor movement or native process is created by this fixture.
import { EventEmitter } from 'node:events';
export const handlers = new Map<string, (...args: any[]) => any>();
export const ipcMain = {
  handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn),
};
export const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  rotation: 0,
};
export const screen = {
  getAllDisplays: () => [display],
  dipToScreenRect: (_w: unknown, rect: unknown) => rect,
};
export const captureMonitorBounds = () => display.bounds;
const partition = {
  setPermissionCheckHandler() {},
  setPermissionRequestHandler() {},
  webRequest: { onBeforeRequest() {} },
  protocol: { handle() {} },
  on() {},
};
export const session = { fromPartition: () => partition };
export class BrowserWindow extends EventEmitter {
  bounds = { x: 1400, y: 12, width: 430, height: 760 };
  protected = false;
  destroyed = false;
  visible = true;
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'one://app/index.html?view=scroll-capture' },
    send() {},
    setWindowOpenHandler() {},
  });
  constructor(_options?: unknown) {
    super();
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  getBounds() {
    return this.bounds;
  }
  hide() {
    this.visible = false;
  }
  show() {
    this.visible = true;
  }
  showInactive() {
    this.visible = true;
  }
  setContentProtection(value: boolean) {
    this.protected = value;
  }
  setAlwaysOnTop() {}
  async loadURL() {}
  destroy() {
    this.destroyed = true;
    this.emit('closed');
  }
}
class Image {
  constructor(
    readonly pixels: Buffer,
    readonly width: number,
    readonly height: number,
  ) {}
  isEmpty() {
    return false;
  }
  getSize() {
    return { width: this.width, height: this.height };
  }
  toBitmap() {
    return Buffer.from(this.pixels);
  }
  toDataURL() {
    return 'data:image/png;base64,fixture';
  }
  toPNG() {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(this.width, 0);
    header.writeUInt32LE(this.height, 4);
    return Buffer.concat([header, this.pixels]);
  }
}
export const nativeImage = {
  createFromBuffer: (bytes: Buffer) =>
    new Image(Buffer.from(bytes.subarray(8)), bytes.readUInt32LE(0), bytes.readUInt32LE(4)),
  createFromBitmap: (bytes: Buffer, size: { width: number; height: number }) =>
    new Image(Buffer.from(bytes), size.width, size.height),
};
export function frame(offset = 0) {
  const width = 96,
    height = 160,
    pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = Math.imul(x + 17, 1103515245) ^ Math.imul(y + offset + 31, 2654435761);
      v ^= v >>> 13;
      v = Math.imul(v, 2246822519);
      v ^= v >>> 16;
      const i = (y * width + x) * 4;
      pixels[i] = v & 255;
      pixels[i + 1] = (v >>> 8) & 255;
      pixels[i + 2] = (v >>> 16) & 255;
      pixels[i + 3] = 255;
    }
  return new Image(pixels, width, height).toPNG();
}
export class ScrollNative {
  static current: ScrollNative;
  ready = Promise.resolve();
  stopped = false;
  focus = true;
  wheels = 0;
  offset = 0;
  reads = 0;
  read?: () => Promise<Buffer>;
  constructor(_rect: unknown) {
    ScrollNative.current = this;
  }
  async frame() {
    this.reads++;
    return this.read ? this.read() : frame(this.offset);
  }
  async focused() {
    return this.focus;
  }
  async wheel() {
    if (!this.focus) return false;
    this.wheels++;
    this.offset += 39;
    return true;
  }
  stop() {
    this.stopped = true;
  }
}
