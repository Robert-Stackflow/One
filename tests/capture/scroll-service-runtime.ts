// Build-time aliases used only by the Node session tests. No desktop windows,
// cursor movement or native process is created by this fixture.
import { EventEmitter } from 'node:events';
export const handlers = new Map<string, (...args: any[]) => any>();
export const escapeListeners=new Set<()=>boolean>();
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
  hides=0;
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'one://app/index.html?view=scroll-capture' },
    send:(channel:string)=>{if(channel==='one:scroll-view')queueMicrotask(()=>handlers.get('one:scroll-ready')?.({sender:this.webContents,senderFrame:this.webContents.mainFrame}));},
    setWindowOpenHandler() {},
    async capturePage(){},
  });
  constructor(readonly options?: any) {
    super();
    if(options?.width)this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};
    if(options?.show===false)this.visible=false;
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
    this.hides++;
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
  shape:any[]=[];
  setShape(rectangles:any[]){this.shape=rectangles;}
  setBounds(bounds:typeof this.bounds){this.bounds=bounds;}
  async loadURL(){await handlers.get('one:scroll-ready')?.({sender:this.webContents,senderFrame:this.webContents.mainFrame});}
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
    return 'data:image/png;base64,'+this.toPNG().toString('base64');
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
  async available(){return this.focus;}
  async activate(_automatic:boolean){return this.focus;}
  permitActivation(){return true;}
  wheels = 0;
  wheelNotches:number[]=[];
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
  async framePixels(){const png=await this.frame();const image=nativeImage.createFromBuffer(png),pixels=image.toBitmap(),owned=new Uint8Array(pixels.byteLength);owned.set(pixels);return {...image.getSize(),pixels:owned};}
  async focused() {
    return this.focus;
  }
  async wheel(_horizontal=false,notches=1) {
    if (!this.focus) return false;
    this.wheels++;
    this.wheelNotches.push(notches);this.offset += 39*notches;
    return true;
  }
  stop() {
    this.stopped = true;
  }
}
