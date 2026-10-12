const {buildSync}=require('esbuild');
const bundle=buildSync({entryPoints:['tests/capture/materials.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});
const fixture={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(fixture,fixture.exports,require);
