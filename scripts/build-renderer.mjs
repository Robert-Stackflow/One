import {build} from 'vite';
import {readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';

await build({
 root:'src/renderer',
 base:'./',
 plugins:[{
  name:'one-prune-current-build',
  async writeBundle(_options,bundle){
   const keep=new Set(Object.keys(bundle));
   for(const item of await readdir('dist/renderer/assets',{withFileTypes:true}).catch(()=>[]))
    if(item.isFile()&&!keep.has('assets/'+item.name))
     await rm(join('dist/renderer/assets',item.name));
  }
 }],
 build:{outDir:'../../dist/renderer',emptyOutDir:false,minify:false},
 logLevel:'warn'
});
