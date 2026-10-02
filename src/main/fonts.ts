import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join, extname, isAbsolute} from 'node:path';
import {stat} from 'node:fs/promises';
import type {InstalledFont} from '../shared/fonts';
const execute = promisify(execFile);
let cache: InstalledFont[] | undefined;
let expires = 0;
let pending: Promise<InstalledFont[]> | undefined;
export function installedFonts(refresh = false): Promise<InstalledFont[]> {
  if (pending) return pending;
  if (!refresh && cache && Date.now() < expires) return Promise.resolve(cache);
  pending = (async () => {
    const helper = join(__dirname, '../native/One.Native.exe').replace('app.asar\\', 'app.asar.unpacked\\');
    const {stdout} = await execute(helper, ['fonts'], {windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8'});
    const result: unknown = JSON.parse(stdout);
    const name = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
    if (!Array.isArray(result) || result.length > 50000 || result.some(f => !f || !name(f.family) || !name(f.label) || !Array.isArray(f.aliases) || f.aliases.some((a: unknown) => !name(a)))) throw new Error('系统字体列表读取失败');
    cache = [...new Map((result as InstalledFont[]).map(f => [f.family.toLocaleLowerCase(), f])).values()]
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', {numeric: true, sensitivity: 'base'}));
    expires = Date.now() + 60000;
    return cache;
  })().finally(() => { pending = undefined; });
  return pending;
}

export async function fontSource(family: unknown): Promise<{path?:string;local:string[]} | null> {
  if (typeof family !== 'string' || !family.trim() || family.length > 256 || /[\x00-\x1f\x7f]/.test(family)) throw new Error('字体名称无效');
  const helper = join(__dirname, '../native/One.Native.exe').replace('app.asar\\', 'app.asar.unpacked\\');
  const {stdout} = await execute(helper, ['font-source', family], {windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024, encoding: 'utf8'});
  const result = JSON.parse(stdout); if (!result) return null;
  const local = [...new Set([result.postscript, result.fullName, family].filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v)))];
  // Collections retain their face-specific local name; loading their first face would select a different font.
  if (result.index === 0 && typeof result.path === 'string' && isAbsolute(result.path) && ['.ttf','.otf'].includes(extname(result.path).toLowerCase())) {
    const entry = await stat(result.path);
    if (entry.isFile() && entry.size > 0 && entry.size <= 80 * 1024 * 1024) return {path: result.path, local};
  }
  return {local};
}
