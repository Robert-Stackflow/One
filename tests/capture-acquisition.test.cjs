const {buildSync}=require('esbuild');
// Run the migrated business fixtures through One's normal Node test discovery.
const bundle=buildSync({stdin:{contents:[
  "import './tests/capture/capture-desktop';",
  "import './tests/capture/capture-selection';",
  "import './tests/capture/capture-session';",
  "import './tests/capture/capture-snapshot';",
].join('\n'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});
const fixture={exports:{}};
new Function('module','exports','require','__dirname',bundle.outputFiles[0].text)(fixture,fixture.exports,require,process.cwd());
