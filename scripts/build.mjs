import './build-native.mjs';
import { build as bundle } from 'esbuild';
import { build } from 'vite';
import { mkdir, readFile, writeFile, readdir, copyFile, cp } from 'node:fs/promises';
import './notices.mjs';
await mkdir('dist/main', { recursive: true });
await mkdir('dist/icons', { recursive: true });
for (const name of await readdir('assets/icons')) if (/^one-\d+\.png$/.test(name) || name === 'one.ico') await copyFile('assets/icons/'+name,'dist/icons/'+name);
await bundle({ entryPoints: ['src/main/index.ts', 'src/main/directory-worker.ts', 'src/main/file-tools-worker.ts', 'src/main/maintenance-worker.ts', 'src/main/search-worker.ts', 'src/main/scan-worker.ts', 'src/main/text-worker.ts', 'src/main/preview-worker.ts','src/main/color-worker.ts','src/main/color-position-worker.ts'], outdir: 'dist/main', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node22', external: ['electron', 'koffi', 'uiohook-napi', 'loudness', 'opencc-js', 'iconv-lite','pdfjs-dist/legacy/build/pdf.mjs','pdfjs-dist/package.json'], sourcemap: true });
await bundle({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', bundle: true, platform: 'node', target: 'node22', external: ['electron'] });
await writeFile('dist/main/system-info.ps1',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),await readFile('src/main/system-info.ps1')]));
await writeFile('dist/main/maintenance-actions.ps1',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),await readFile('src/main/maintenance-actions.ps1')]));
await writeFile('dist/main/maintenance.ps1', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile('src/main/maintenance.ps1')]));
await writeFile('dist/main/brightness.ps1', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile('src/main/brightness.ps1')]));
await build({ root: 'src/renderer', base: './', build: { outDir: '../../dist/renderer', emptyOutDir: true }, logLevel: 'warn' });
for(const folder of ['cmaps','standard_fonts','wasm'])await cp('node_modules/pdfjs-dist/'+folder,'dist/renderer/pdf/'+folder,{recursive:true});
await cp('assets/file-icons','dist/renderer/file-icons',{recursive:true});
console.log('Electron build complete.');

