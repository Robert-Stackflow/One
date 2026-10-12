import { dialog, nativeImage, BrowserWindow } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { imageSize } from 'image-size';
import { imageDimensions } from '../../shared/capture/image-limits';
import { WATERMARK_IMAGE_EDGE, watermarkImage, type WatermarkImage } from '../../shared/capture/watermark';

const FILE_BYTES = 20 * 1024 * 1024;
async function decodeRaster(input: Buffer, mime: string, width: number, height: number) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      (async () => {
        await window.loadURL(
          'data:text/html,' +
            encodeURIComponent(
              `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'none'"><title>Watermark decode</title>`,
            ),
        );
        const ratio = Math.min(1, WATERMARK_IMAGE_EDGE / Math.max(width, height));
        const png: string = await window.webContents.executeJavaScript(
          `(async()=>{const image=new Image();image.src=${JSON.stringify('data:' + mime + ';base64,' + input.toString('base64'))};await image.decode();if(image.naturalWidth!==${width}||image.naturalHeight!==${height})throw Error('Image dimensions changed');const canvas=document.createElement('canvas');canvas.width=${Math.max(1, Math.round(width * ratio))};canvas.height=${Math.max(1, Math.round(height * ratio))};canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png')})()`,
        );
        return nativeImage.createFromDataURL(png);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('水印图片读取超时，请选择较小的图片')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
  }
}
export async function readWatermarkImage(file: string): Promise<WatermarkImage> {
  const info = await stat(file);
  if (!info.isFile() || info.size < 1 || info.size > FILE_BYTES)
    throw Error('水印图片文件最多 20 MiB');
  const input = await readFile(file);
  if (input.length > FILE_BYTES) throw Error('水印图片文件最多 20 MiB');
  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(input);
  } catch {
    throw Error('无法读取水印图片，请选择其他文件');
  }
  if (!['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(size.type || ''))
    throw Error('水印图片支持 PNG、JPEG、WebP 和 BMP');
  imageDimensions(size.width, size.height);
  let image = nativeImage.createFromBuffer(input);
  if (image.isEmpty()) {
    try {
      image = await decodeRaster(
        input,
        'image/' + (['jpg', 'jpeg'].includes(size.type!) ? 'jpeg' : size.type),
        size.width,
        size.height,
      );
    } catch {
      throw Error('无法读取水印图片，请选择其他文件');
    }
  }
  if (image.isEmpty()) throw Error('无法读取水印图片，请选择其他文件');
  const source = image.getSize();
  imageDimensions(source.width, source.height);
  const ratio = Math.min(1, WATERMARK_IMAGE_EDGE / Math.max(source.width, source.height));
  if (ratio < 1)
    image = image.resize({
      width: Math.max(1, Math.round(source.width * ratio)),
      height: Math.max(1, Math.round(source.height * ratio)),
      quality: 'best',
    });
  const { width, height } = image.getSize(),
    bitmap = image.toBitmap(),
    rgba = Buffer.alloc(width * height * 4);
  // Windows nativeImage exposes premultiplied BGRA. Persist portable straight-alpha RGBA.
  for (let at = 0; at < bitmap.length; at += 4) {
    const alpha = bitmap[at + 3];
    rgba[at + 3] = alpha;
    if (alpha)
      for (let channel = 0; channel < 3; channel++)
        rgba[at + channel] = Math.min(255, Math.round((bitmap[at + 2 - channel] * 255) / alpha));
  }
  return watermarkImage({ width, height, rgba: rgba.toString('base64'), scale: 1 });
}
export async function chooseWatermarkImage(window: BrowserWindow, valid: () => boolean) {
  const result = await dialog.showOpenDialog(window, {
    title: '选择水印图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  if (!valid()) throw Error('水印图片导入已取消');
  if (result.canceled || !result.filePaths[0]) return null;
  const image = await readWatermarkImage(result.filePaths[0]);
  if (!valid()) throw Error('水印图片导入已取消');
  return image;
}
