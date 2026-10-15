const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
const source=JSON.parse(fs.readFileSync('package.json'));
const build=path.resolve(process.env.ONE_BUILD_DIR||'dist'),fromBuild=file=>path.join(build,path.relative('dist',file));
const root=path.resolve(process.env.ONE_PACKAGE_DIR||`release/${source.version}/win-unpacked`),archive=path.join(root,'resources/app.asar');
const pkg=JSON.parse(asar.extractFile(archive,'package.json'));assert.equal(pkg.version,source.version);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const code=[path.join('dist','main','index.cjs'),path.join('dist','preload','index.cjs'),path.join('dist','main','file-tools-worker.cjs'),path.join('dist','main','text-worker.cjs'),path.join('dist','renderer','index.html')];
for(const worker of [['recording','recording-gif-worker'],['recognition','ocr-worker'],['recognition','ocr-engine'],['recognition','paddle-worker'],['recognition','formula-local-worker'],['recognition','formula-image-worker'],['recognition','ocr-tile-worker'],['capture','scroll-worker']])code.push(path.join('dist','main',worker[0],worker[1]+'.cjs'));
for(const preload of ['recording-toolbar','recording-input-overlay','recording-camera-overlay','recording-annotation-overlay','recording-region-overlay','recording-player','recording-export','recording-countdown','image-editor','pin','capture','scroll-capture','recognition','formula-recognition'])code.push(path.join('dist','preload',preload+'.cjs'));
for(const file of fs.readdirSync(path.join(build,'renderer/assets')))if(file.endsWith('.css')||file.endsWith('.js'))code.push(path.join('dist','renderer','assets',file));
for(const file of code)assert.equal(hash(asar.extractFile(archive,file)),hash(fs.readFileSync(fromBuild(file))),file);
const native=['OpenWith','Native','Search','Index','Windows','Monitor','Levels','CaptureProbe','SingleCapture','ScrollCapture','RecordingSources','RecordingAudio','RecordingVideo'];
for(const name of native){const file=path.join('dist','native','One.'+name+'.exe');assert.equal(hash(fs.readFileSync(path.join(root,'resources/app.asar.unpacked',file))),hash(fs.readFileSync(fromBuild(file))),file);}
assert.ok(fs.statSync(path.join(root,'One.exe')).size>0);
const ocrRuntime=[{module:'tesseract.js',file:path.join('src','worker-script','node','index.js')}];
const core=path.dirname(require.resolve('tesseract.js-core/package.json'));
for(const file of fs.readdirSync(core).filter(file=>/^tesseract-core.*\.wasm(?:\.js)?$/.test(file)))ocrRuntime.push({module:'tesseract.js-core',file});
assert.equal(ocrRuntime.length,13,'All pinned OCR WASM variants and the Node worker must be checked');
for(const item of ocrRuntime){const file=path.join('node_modules',item.module,item.file),sourceFile=path.join(path.dirname(require.resolve(item.module+'/package.json')),item.file);assert.equal(asar.statFile(archive,file).unpacked,true,file+' must be unpacked');assert.equal(hash(fs.readFileSync(path.join(archive+'.unpacked',file))),hash(fs.readFileSync(sourceFile)),file);}
console.log(JSON.stringify({result:'PASS',version:pkg.version,codeAndStyles:code.length,nativeHelpers:native.length,ocrRuntimeFiles:ocrRuntime.length,root}));
