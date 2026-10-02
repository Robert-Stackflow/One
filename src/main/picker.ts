import { app, BrowserWindow } from 'electron';
import { access, readdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { PickerData } from '../shared/types';
interface State { mode: PickerData['mode']; title: string; path: string; name: string; settle(path: string | null): void }
const states = new Map<number, State>();
let driveCache: string[] | null = null;
export function pick(window: BrowserWindow, mode: PickerData['mode'], title: string, name = ''): Promise<string | null> {
  return new Promise(accept => { const id = window.webContents.id; states.set(id, { mode, title, path: app.getPath('documents'), name, settle: accept }); window.on('closed', () => { states.get(id)?.settle(null); states.delete(id); }); });
}
export async function pickerData(id: number, path?: string): Promise<PickerData> {
  const state = states.get(id); if (!state) throw new Error('选择窗口已关闭');
  let current = path === undefined ? state.path : path; if (!isAbsolute(current) || current.length > 32768 || current.includes('\0')) throw new Error('目录无效'); current = resolve(current);
  const entries = await readdir(current, { withFileTypes: true }); state.path = current;
  if (!driveCache) { const drives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => letter + ':\\'); driveCache = (await Promise.all(drives.map(async path => { try { await access(path); return path; } catch { return ''; } }))).filter(Boolean); }
  return { mode: state.mode, title: state.title, path: current, parent: dirname(current), name: state.name, drives: driveCache, entries: entries.filter(entry => !entry.isSymbolicLink()).map(entry => ({ name: entry.name, path: join(current,entry.name), directory: entry.isDirectory() })).filter(entry => state.mode !== 'directory' || entry.directory).sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name)) };
}
export async function choose(window: BrowserWindow, path: string, overwrite = false): Promise<{ overwrite: boolean }> {
  const id = window.webContents.id; const state = states.get(id); if (!state) throw new Error('选择窗口已关闭');
  if (!isAbsolute(path) || path.includes('\0') || path.length > 32768) throw new Error('路径无效'); path = resolve(path);
  if (state.mode === 'save') {
    if (dirname(path) !== state.path || !basename(path) || /[<>:"|?*]/.test(basename(path)) || /[. ]$/.test(basename(path)) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(basename(path))) throw new Error('文件名无效');
    try { const info = await stat(path); if (!info.isFile()) throw new Error('目标不是文件'); if (!overwrite) return { overwrite: true }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  } else { const info = await stat(path); if (state.mode === 'file' && !info.isFile()) throw new Error('请选择文件'); if (state.mode === 'directory' && !info.isDirectory()) throw new Error('请选择目录'); }
  state.settle(path); states.delete(id); setTimeout(() => { if(!window.isDestroyed())window.close(); }, 30); return { overwrite: false };
}
