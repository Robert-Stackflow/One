const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
async function moduleFor(file){const bundle=await build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false});const m={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(m,m.exports,require);return m.exports;}
test('directory priorities preserve legacy exclusions, validate levels and normalize duplicates',async()=>{
 const {defaultSearch,validateSearch}=await moduleFor('src/shared/search.ts');const old=defaultSearch();delete old.priorities;old.excluded=['C:\\Excluded'];assert.deepEqual(validateSearch(old).priorities,[]);assert.deepEqual(validateSearch(old).excluded,old.excluded);
 const value=validateSearch({...old,priorities:[{path:'C:\\Work',priority:'high'},{path:'c:/WORK/',priority:'uncommon'}]});assert.deepEqual(value.priorities,[{path:'c:/WORK/',priority:'uncommon'}]);for(const priorities of [[{path:'relative',priority:'high'}],[{path:'C:\\Work',priority:'hidden'}],Array.from({length:65},(_,i)=>({path:'C:\\'+i,priority:'high'}))])assert.throws(()=>validateSearch({...old,priorities}));
});
