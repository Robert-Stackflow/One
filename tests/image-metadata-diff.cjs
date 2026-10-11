const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {resolve}=require('node:path');

test('metadata diff omits file paths and bounds tag details',()=>{
 const outfile=resolve('work/current/image-metadata-diff.cjs');buildSync({entryPoints:['src/shared/image-metadata.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 const {imageMetadataDiff}=require(outfile),before={SourceFile:'before.jpg','IFD0:Artist':'One',...Object.fromEntries(Array.from({length:105},(_,index)=>[`XMP:Tag${index}`,`value${index}`]))},after={SourceFile:'after.jpg','IFD0:Artist':'Two'};
 const diff=imageMetadataDiff(before,after);assert.equal(diff.count,106);assert.equal(diff.changes.length,100);assert.equal(diff.truncated,true);assert(!diff.changes.some(change=>change.tag==='SourceFile'));assert.deepEqual(diff.changes[0],{tag:'IFD0:Artist',before:'One',after:'Two'});
});
