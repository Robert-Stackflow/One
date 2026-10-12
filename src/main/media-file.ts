import { t as tr } from '../shared/capture/i18n';
import koffi from 'koffi';
import { toNamespacedPath, resolve, dirname } from 'node:path';
type MoveFile = ((source: string, target: string, flags: number) => boolean) & {
  async(source: string, target: string, flags: number,
    callback: (error: Error | null, success: boolean) => void): void;
};
let move: MoveFile | undefined,
  errorCode: (() => number) | undefined;
function prepare(source: string, target: string) {
  if (dirname(resolve(source)).toLowerCase() !== dirname(resolve(target)).toLowerCase())
    throw new Error(tr('媒体暂存必须位于目标文件夹'));
  if (!move) {
    const kernel = koffi.load('kernel32.dll');
    move = kernel.func(
      'bool __stdcall MoveFileExW(str16 source,str16 target,uint32 flags)',
    ) as MoveFile;
    errorCode = kernel.func('uint32 __stdcall GetLastError()');
  }
  return move;
}
function failure() {
  const code = errorCode!(),
    error = new Error(
      code === 80 || code === 183
        ? tr('文件已存在，请选择新文件名')
        : tr`无法保存媒体文件（Windows ${code}）`,
    ) as NodeJS.ErrnoException;
  error.code = code === 80 || code === 183 ? 'EEXIST' : 'EIO';
  return error;
}
// Default commits reject existing files. A caller may replace only a destination
// explicitly selected and rechecked by its own save-dialog transaction.
export function commitRecording(source: string, target: string, replace = false) {
  if (
    !prepare(source, target)(
      toNamespacedPath(source),
      toNamespacedPath(target),
      8 | (replace ? 1 : 0),
    )
  )
    throw failure();
}
/** Koffi >= 3.2 restores the worker's GetLastError in this callback. Keep it on the same callback stack. */
export function commitImageFile(source: string, target: string, replace = false): Promise<void> {
  const action = prepare(source, target);
  return new Promise((resolve, reject) => {
    action.async(
      toNamespacedPath(source),
      toNamespacedPath(target),
      8 | (replace ? 1 : 0),
      (error, success) => {
        if (error) reject(error);
        else if (!success) reject(failure());
        else resolve();
      },
    );
  });
}
