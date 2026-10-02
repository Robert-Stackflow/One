import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { PickerPreferences, PickerBounds } from '../shared/picker';
const defaults: PickerPreferences = {showHidden: false, showExtensions: true};
export const pickerPath = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && path.length <= 32768 && !path.includes('\0');
export function uniquePickerPaths(paths: unknown[], limit = 20) {
 const seen = new Set<string>(), result: string[] = [];
 for (const path of paths) if (pickerPath(path)) {
  const normalized = resolve(path), key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  if (!seen.has(key)) { seen.add(key); result.push(normalized); if (result.length === limit) break; }
 }
 return result;
}
/** One small profile file; remembering a location never copies its contents. */
export class PickerStore {
 preferences = {...defaults}; recent: string[] = []; bounds?: PickerBounds;
 private loaded?: Promise<void>; private writing = Promise.resolve();
 constructor(private file: string) {}
 load() {
  return this.loaded ||= readFile(this.file,'utf8').then(text => {
   const value = JSON.parse(text);
   if (typeof value?.showHidden === 'boolean') this.preferences.showHidden = value.showHidden;
   if (typeof value?.showExtensions === 'boolean') this.preferences.showExtensions = value.showExtensions;
   if (Array.isArray(value?.recent)) this.recent = uniquePickerPaths(value.recent);
   const b=value?.bounds;
   if(b && ['x','y','width','height'].every(key=>Number.isFinite(b[key])&&Math.abs(b[key])<=100_000)&&b.width>0&&b.height>0)this.bounds={x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height)};
  }).catch(() => {});
 }
 private save() {
  const snapshot = JSON.stringify({...this.preferences, recent: this.recent, bounds:this.bounds});
  const next = this.writing.catch(() => {}).then(async () => {
   await mkdir(dirname(this.file), {recursive: true});
   await writeFile(this.file + '.tmp', snapshot); await rename(this.file + '.tmp', this.file);
  }); this.writing = next; return next;
 }
 async update(value: PickerPreferences) {
  if (!value || typeof value.showHidden !== 'boolean' || typeof value.showExtensions !== 'boolean') throw new Error('显示选项无效');
  await this.load(); this.preferences = {showHidden: value.showHidden, showExtensions: value.showExtensions};
  await this.save(); return {...this.preferences};
 }
 async remember(path: string) {
  await this.load(); this.recent = uniquePickerPaths([path,...this.recent]); await this.save();
 }
 async clearRecent() { await this.load(); this.recent = []; await this.save(); }
 async windowBounds(bounds: PickerBounds) { await this.load(); this.bounds={...bounds}; await this.save(); }
 async flush() { await this.writing; }
}
