const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
const source=JSON.parse(fs.readFileSync('package.json'));
const root=path.resolve(process.env.ONE_PACKAGE_DIR||`release/${source.version}/win-unpacked`),archive=path.join(root,'resources/app.asar');
const pkg=JSON.parse(asar.extractFile(archive,'package.json'));assert.equal(pkg.version,source.version);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const code=[path.join('dist','main','index.cjs'),path.join('dist','preload','index.cjs'),path.join('dist','main','file-tools-worker.cjs'),path.join('dist','main','text-worker.cjs'),path.join('dist','renderer','index.html')];
for(const file of fs.readdirSync('dist/renderer/assets'))if(file.endsWith('.css')||file.endsWith('.js'))code.push(path.join('dist','renderer','assets',file));
for(const file of code)assert.equal(hash(asar.extractFile(archive,file)),hash(fs.readFileSync(file)),file);
const native=['OpenWith','Native','Search','Index','Windows','Monitor','Levels'];
for(const name of native){const file=path.join('dist','native','One.'+name+'.exe');assert.equal(hash(fs.readFileSync(path.join(root,'resources/app.asar.unpacked',file))),hash(fs.readFileSync(file)),file);}
assert.ok(fs.statSync(path.join(root,'One.exe')).size>0);
console.log(JSON.stringify({result:'PASS',version:pkg.version,codeAndStyles:code.length,nativeHelpers:native.length,root}));
