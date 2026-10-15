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
  const notices=['LICENSE','LICENSE.md','LICENSE.txt','THIRD_PARTY_LICENSES.md','THIRD_PARTY_NOTICES.md'];
  if(metadata.name==='@aiden0z/pptx-renderer')notices.push('licenses/mtx-decompressor-MPL-2.0.txt','licenses/ECMA-text-copyright-notice.txt');
  for (const file of notices) {
    try { output += await readFile(join(root, file), 'utf8') + '\n'; } catch {}
  }
}
const crates=JSON.parse(execFileSync('cargo',['metadata','--locked','--format-version','1','--manifest-path','native/search-engine/Cargo.toml'],{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024}));
for(const crate of crates.packages.filter(p=>p.source)){
  output+=`\n===== Rust: ${crate.name} ${crate.version} =====\nLicense: ${crate.license||'See package notices'}\nSource: ${crate.repository||crate.source}\n`;
  const root=resolve(crate.manifest_path,'..');
  for(const file of await readdir(root))if(/^(license|copying|copyright|notice)/i.test(file))try{output+=await readFile(join(root,file),'utf8')+'\n';}catch{}
}
for(const [name,version,source] of [
  ['minizip-ng','4.1.2','https://github.com/zlib-ng/minizip-ng'],
  ['zlib','1.3.1','https://github.com/madler/zlib']
]){
  output+=`\n===== Native archive: ${name} ${version} =====\nSource: ${source}\nLicense: zlib\n`;
  if(name==='minizip-ng')output+='Altered by One; additional authentication and empty-XZ changes: vendor/archive/minizip-ng/ONE-PATCHES.txt\n';
  output+=await readFile(`vendor/archive/${name}/LICENSE`,'utf8')+'\n';
}
output+='\n===== Native archive: liblzma (XZ Utils) 5.8.2 =====\nSource: https://github.com/tukaani-project/xz/releases/tag/v5.8.2\nLicense: 0BSD\n'+await readFile('vendor/archive/xz/COPYING.0BSD','utf8')+'\n';
output+='\n===== Native archive: bzip2 1.0.8 with One ALZ framing =====\nSource: https://deb.debian.org/debian/pool/main/b/bzip2/bzip2_1.0.8.orig.tar.gz\nLicense: bzip2 license, altered version; see vendor/archive/alz-bzip2/MODIFICATIONS.txt\n'+await readFile('vendor/archive/alz-bzip2/LICENSE','utf8')+'\n===== ALZ framing reference: UnAlz 0.65 =====\nSource: https://deb.debian.org/debian/pool/main/u/unalz/unalz_0.65.orig.tar.gz\nLicense: zlib\n'+await readFile('vendor/archive/alz-bzip2/UNALZ-LICENSE.txt','utf8')+'\n';
output+='\n===== Native archive: EGG AZO/LEA models from EggDotNet (ported by One) =====\nSource: https://github.com/akolman/EggDotNet/tree/78b64f54026a8687dac1cdd4c86eb5fe5abf04ae\nLicense: MIT; port and bounded decoding changes: vendor/archive/egg/SOURCE.txt\n'+await readFile('vendor/archive/egg/LICENSE.EggDotNet.txt','utf8')+'\n';
output+='\n===== Native archive: 7-Zip 26.04 (7z.dll, altered by One) =====\nSource: https://github.com/ip7z/7zip/tree/9128b80e3a471108678e2b3ec3c985861c8d7b0f\nCorresponding source and changes: vendor/archive/7zip/7zip-26.04-source.tar.gz, one-password-codepage.patch, one-lha-headers.patch, one-cab-volumes.patch and MODIFICATIONS.txt\n';
output+=await readFile('vendor/archive/7zip/License.txt','utf8')+'\n';
output+='\n===== ZXing-C++ WebAssembly engine =====\nSource: https://github.com/zxing-cpp/zxing-cpp/tree/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4\nLicense: Apache-2.0\n'+await readFile('assets/licenses/zxing-cpp-LICENSE.txt','utf8')+'\n';
output+='\n===== Optional U²-Net-p background removal model =====\nSource: https://huggingface.co/skillsafe-ai/u2netp/tree/33f0c8b5c2429bcf0cfd62bbf48669eeec80c2a2\nSHA-256: 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8\nLicense: Apache-2.0 (downloaded only on first use)\n'+await readFile('assets/licenses/zxing-cpp-LICENSE.txt','utf8')+'\n';
output+='\n===== Optional Real-ESRGAN general x4 v3 model =====\nWeights: https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth\nONNX conversion: https://github.com/ningtoba/Browsersnip-Upscale/tree/8e7094416ad91ec7477e968d348cd78742e20dc6/public/models\nSHA-256: 4ca39b3a965ecab832861860f046400bdac7727e10f40cc75ab2393104346e08\nLicense: BSD-3-Clause (downloaded only on first use)\n'+await readFile('assets/licenses/realesrgan-LICENSE.txt','utf8')+'\n';
output+='\n===== Optional MI-GAN local inpainting model =====\nSource: https://huggingface.co/andraniksargsyan/migan/tree/406830d0fa60666da0071c342ad2fbc8f30c5c64\nSHA-256: 6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b\nLicense: MIT (downloaded only on first use)\n'+await readFile('assets/licenses/migan-LICENSE-WEIGHTS.txt','utf8')+'\n';
output+='\n===== Pillow 12.3.0 RGB resampling (TypeScript port) =====\nSource: https://github.com/python-pillow/Pillow/tree/bb1d8e8ab8d29048624d96e3ee53cecf7c13d13d\nLicense: MIT-CMU\n'+await readFile('assets/licenses/pillow-LICENSE.txt','utf8')+'\n';
output+='\n===== vscode-icons artwork =====\nSource: https://github.com/vscode-icons/vscode-icons\n'+await readFile('assets/file-icons/LICENSE','utf8');
await writeFile('THIRD_PARTY_NOTICES.txt', output.replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,''), 'utf8');
