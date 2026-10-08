import {build} from 'vite';

await build({
 root:'src/renderer',
 base:'./',
 // A visible window can still refer to an older lazy-loaded chunk until the
 // dev process sends its reload. Keep old assets throughout this dev session.
 // A full production build clears the output directory instead.
 build:{outDir:'../../dist/renderer',emptyOutDir:false,minify:false},
 logLevel:'warn'
});
