import { dialog, type BrowserWindow } from 'electron';
import { writeFile, stat, unlink, copyFile } from 'node:fs/promises';
import {constants} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { commitImageFile } from '../media-file';
type Payload = {png:string};
export async function saveImage(
  window: BrowserWindow,
  item: { payload: Payload },
  protect: (file: string) => void,
  valid: () => boolean,
  options: { title?: string; defaultPath?: string; pngExtension?: boolean } = {},
) {
  return savePng(window,stage=>writeFile(stage,Buffer.from(item.payload.png,'base64'),{flag:'wx',mode:0o600}),protect,valid,options);
}
/** The long-image exporter already owns a PNG on disk; do not base64 or decode it. */
export async function saveImageFile(window:BrowserWindow,file:string,protect:(file:string)=>void,valid:()=>boolean,options:{title?:string;defaultPath?:string}={}){
  return savePng(window,stage=>copyFile(file,stage,constants.COPYFILE_EXCL),protect,valid,options);
}
async function savePng(window:BrowserWindow,writeStage:(stage:string)=>Promise<void>,protect:(file:string)=>void,valid:()=>boolean,options:{title?:string;defaultPath?:string}){
  const result = await dialog.showSaveDialog(window, {
    title: options.title || '另存图片',
    defaultPath: options.defaultPath || 'One-image.png',
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const destination = result.filePath.toLowerCase().endsWith('.png')
    ? result.filePath
    : result.filePath + '.png';
  protect(destination);
  if (!valid()) throw Error('保存已取消');
  let previous: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    previous = await stat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stage = join(dirname(destination), '.one-image-export-' + randomUUID() + '.part');
  try {
    await writeStage(stage);
    if (!valid()) throw Error('保存已取消');
    if (previous) {
      const current = await stat(destination);
      if (
        current.ino !== previous.ino ||
        current.mtimeMs !== previous.mtimeMs ||
        current.size !== previous.size
      )
        throw Error('目标文件已改变，请重新保存');
    }
    await commitImageFile(stage, destination, !!previous);
    return basename(destination);
  } finally {
    await unlink(stage).catch(() => {});
  }
}
