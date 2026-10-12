import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** Replace only after the complete file is durable; never delete the previous file to retry. */
export async function atomicWrite(
  file: string,
  contents: string | Uint8Array,
  replace: (stage: string, destination: string) => Promise<void> = rename,
) {
  const stage = file + '.' + randomUUID() + '.next';
  try {
    await writeFile(stage, contents, { mode: 0o600, flag: 'wx', flush: true });
    for (let attempt = 0; ; attempt++) {
      try {
        await replace(stage, file);
        return;
      } catch (error) {
        // Antivirus/indexers can briefly hold a Windows file across an atomic replacement.
        if (
          process.platform !== 'win32' ||
          attempt >= 6 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')
        )
          throw error;
        await delay(16 * 2 ** attempt);
      }
    }
  } finally {
    await unlink(stage).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
