import { lstat, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function markExportScratch(directory: string, id: string, destination: string) {
  if (!idPattern.test(id)) throw Error('合成任务编号无效');
  const stage = join(dirname(resolve(destination)), '.One-compose-' + id + '.part');
  await writeFile(join(directory, '.one-compose'), JSON.stringify({ version: 1, id, stage }), {
    flag: 'wx',
    mode: 0o600,
  });
}
/** Delete only a direct owned scratch directory and its specifically named unpublished output. */
export async function cleanExportScratchDirectory(
  rootDirectory: string,
  directory: string,
  expectedId?: string,
) {
  const root = await realpath(rootDirectory),
    info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) return false;
  const actual = await realpath(directory);
  if (dirname(actual) !== root || !/^compose-[a-zA-Z0-9]{6}$/.test(basename(actual))) return false;
  const marker = join(actual, '.one-compose'),
    markerInfo = await lstat(marker).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
  if (
    !markerInfo ||
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    markerInfo.size > 128 * 1024
  )
    return false;
  let record: { version: number; id: string; stage: string };
  try {
    record = JSON.parse(await readFile(marker, 'utf8'));
  } catch {
    return false;
  }
  if (
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    !idPattern.test(record.id) ||
    (expectedId && record.id !== expectedId) ||
    typeof record.stage !== 'string' ||
    !isAbsolute(record.stage) ||
    resolve(record.stage) !== record.stage ||
    basename(record.stage) !== '.One-compose-' + record.id + '.part'
  )
    return false;
  const stageInfo = await lstat(record.stage).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (stageInfo) {
    if (!stageInfo.isFile() || stageInfo.isSymbolicLink())
      throw Error('合成输出暂存类型已变化，已保留现场');
    await unlink(record.stage);
  }
  await rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return true;
}
/** Called once at app initialization, before this process can own an export job. */
export async function cleanInterruptedExports(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (
      entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      /^compose-[a-zA-Z0-9]{6}$/.test(entry.name)
    )
      await cleanExportScratchDirectory(directory, join(directory, entry.name));
}
