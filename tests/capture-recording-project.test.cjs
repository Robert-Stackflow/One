const {buildSync} = require('esbuild');
const result = buildSync({
  entryPoints: ['tests/capture/recording-project.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['koffi'],
});
const fixture = {exports: {}};
new Function('module', 'exports', 'require', result.outputFiles[0].text)(fixture, fixture.exports, require);
