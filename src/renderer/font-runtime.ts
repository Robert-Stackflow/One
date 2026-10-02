import {fontStack, type UIFont} from '../shared/fonts';
import {api} from './ui';
const cache = new Map<UIFont, Promise<string>>();
const faces = new Map<UIFont, FontFace>();
let applied: UIFont = 'system';
const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
let serial = 0;
/** Load the selected face explicitly, including fonts installed after Chromium started. */
export function loadUIFont(value: UIFont, apply = false): Promise<string> {
  if(apply) applied=value;
  if (!value.startsWith('installed:')) return Promise.resolve(fontStack(value));
  const existing = cache.get(value); if (existing) return existing;
  const pending = (async () => {
    const source = await api.uiFontSource(value.slice(10));
    if (!source) return fontStack(value);
    const alias = 'One UI ' + (++serial);
    const candidates = [...(source.url ? ['url(' + quote(source.url) + ')'] : []), ...source.local.map(name => 'local(' + quote(name) + ')')];
    const face = new FontFace(alias, candidates.join(','));
    await face.load(); document.fonts.add(face); faces.set(value,face);
    // Hovering a large installed-font list must not retain hundreds of font files.
    for(const [old,loaded] of faces){if(faces.size<=6)break;if(old===applied||old===value)continue;document.fonts.delete(loaded);faces.delete(old);cache.delete(old);}
    return quote(alias) + ',' + fontStack(value);
  })().catch(error => {cache.delete(value); throw error;});
  cache.set(value, pending); return pending;
}
export function refreshUIFontCache(){for(const key of cache.keys()){if(key!==applied||!faces.has(key)){const face=faces.get(key);if(face)document.fonts.delete(face);faces.delete(key);cache.delete(key);}}}
