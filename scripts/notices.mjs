import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json','utf8'));
// Renderer dependencies are bundled even when npm marks them as dev-only.
// Include their notices alongside the native runtime dependencies.
const packages = Object.keys(lock.packages).filter(path => path.startsWith('node_modules/'));
let output = 'One — Third-party notices\nElectron and Chromium notices are distributed alongside One.exe.\n\n';
for (const path of packages) {
  const root = resolve(path);
  let metadata; try { metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); } catch { continue; }
  output += `\n===== ${metadata.name} ${metadata.version} =====\nLicense: ${metadata.license || 'See package notices'}\n`;
  for (const file of ['LICENSE','LICENSE.md','LICENSE.txt','THIRD_PARTY_LICENSES.md']) {
    try { output += await readFile(join(root, file), 'utf8') + '\n'; } catch {}
  }
}
const crates=JSON.parse(execFileSync('cargo',['metadata','--locked','--format-version','1','--manifest-path','native/search-engine/Cargo.toml'],{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024}));
for(const crate of crates.packages.filter(p=>p.source)){
  output+=`\n===== Rust: ${crate.name} ${crate.version} =====\nLicense: ${crate.license||'See package notices'}\nSource: ${crate.repository||crate.source}\n`;
  const root=resolve(crate.manifest_path,'..');
  for(const file of await readdir(root))if(/^(license|copying|copyright|notice)/i.test(file))try{output+=await readFile(join(root,file),'utf8')+'\n';}catch{}
}
output+='\n===== vscode-icons artwork =====\nSource: https://github.com/vscode-icons/vscode-icons\n'+await readFile('assets/file-icons/LICENSE','utf8');
await writeFile('THIRD_PARTY_NOTICES.txt', output.replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,''), 'utf8');
