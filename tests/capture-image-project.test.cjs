const {buildSync} = require('esbuild');
// Keep migrated business fixtures in TypeScript while using One's standard test discovery.
const result = buildSync({
  entryPoints: ['tests/capture/image-project.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['koffi'],
});
const fixture = {exports: {}};
new Function('module', 'exports', 'require', result.outputFiles[0].text)(fixture, fixture.exports, require);
