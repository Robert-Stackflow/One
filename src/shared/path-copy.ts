import {win32} from 'node:path';

export type PathCopyFormat='full'|'relative'|'name'|'quoted';

export function pathCopyText(path:string,format:PathCopyFormat,roots:string[]=[]):string{
 if(format==='full')return path;
 if(format==='name')return win32.basename(path);
 if(format==='quoted')return `"${path}"`;
 const resolved=win32.resolve(path),lower=resolved.toLowerCase();
 const root=roots.map(value=>win32.resolve(value)).filter(value=>lower===value.toLowerCase()||lower.startsWith(value.toLowerCase().replace(/[\\]+$/,'')+'\\')).sort((a,b)=>b.length-a.length)[0]||win32.dirname(resolved);
 return win32.relative(root,resolved)||'.';
}
