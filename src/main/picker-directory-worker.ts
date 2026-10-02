import { parentPort, workerData } from 'node:worker_threads';
import { opendir } from 'node:fs/promises';
import { join, toNamespacedPath } from 'node:path';
import type { PickerEntry } from '../shared/picker';

async function read() {
 const {path, mode, showHidden} = workerData as {path: string; mode: string; showHidden: boolean};
 // Windows hidden attributes are unrelated to a leading dot. Keep native calls,
 // enumeration and sorting off the Electron event loop, including on slow drives.
 const attributes: ((path: string) => number) | undefined = process.platform === 'win32'
  ? require('koffi').load('kernel32.dll').func('uint32 __stdcall GetFileAttributesW(str16 path)') : undefined;
 const entries: PickerEntry[] = [], directory = await opendir(path);
 for await (const entry of directory) {
  if (entry.isSymbolicLink() || mode === 'directory' && !entry.isDirectory()) continue;
  const full = join(path, entry.name), flags = attributes?.(toNamespacedPath(full));
  const hidden = attributes ? flags !== 0xffffffff && !!(flags! & 2) : entry.name.startsWith('.');
  if (hidden && !showHidden) continue;
  entries.push({name: entry.name, path: full, directory: entry.isDirectory(), hidden});
 }
 const collator = new Intl.Collator('zh-CN', {numeric: true, sensitivity: 'base'});
 entries.sort((a,b) => Number(b.directory) - Number(a.directory) || collator.compare(a.name,b.name));
 parentPort!.postMessage({entries});
}
void read().catch(error => parentPort!.postMessage({error: String(error.message || error)}));
