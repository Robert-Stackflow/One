export type UIFont = 'system' | 'sans' | 'mono' | `installed:${string}`;
export interface InstalledFont { family: string; label: string; aliases: string[] }
export interface UIFontSource { url?: string; local: string[] }
export const fontPresets = [
  { value: 'system', label: '系统默认' },
  { value: 'sans', label: '无衬线' },
  { value: 'mono', label: '等宽' }
] as const;
export function validFont(value: unknown): value is UIFont {
  return typeof value === 'string' && (fontPresets.some(p => p.value === value) ||
    value.startsWith('installed:') && value.length <= 266 && value.slice(10).trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value));
}
export function fontStack(value: UIFont): string {
  const fallback = "'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',sans-serif";
  if (value === 'mono') return "'Cascadia Code',Consolas,'Microsoft YaHei UI',monospace";
  if (value === 'sans') return "Arial,'Microsoft YaHei UI',sans-serif";
  if (value.startsWith('installed:')) return '"' + value.slice(10).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '",' + fallback;
  return fallback;
}
