const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),vm=require('node:vm');
const result=buildSync({stdin:{contents:'export * from "./src/renderer/text-document"; export {Text,EditorState} from "@codemirror/state";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
const sandbox={module:{exports:{}},exports:null,require,setTimeout,performance};sandbox.exports=sandbox.module.exports;vm.runInNewContext(result.outputFiles[0].text,sandbox);const {parseText,serializeText,serializeTextAsync,editEndings,Text,EditorState}=sandbox.module.exports;
test('continuous document preserves LF, CRLF, CR, Unicode and chunk boundaries',async()=>{
 for(const text of ['', '甲\n乙\r\n丙\r丁\n','x'.repeat(65535)+'\r\n🙂末尾','x'.repeat(65535)+'🙂\r尾','\n'.repeat(300000),'单行'.repeat(300000)]){
  const value=await parseText(text);assert.equal(serializeText(value.doc,value.endings),text);assert.equal(await serializeTextAsync(value.doc,value.endings),text);assert.equal(value.doc.length+value.endings.extra,text.length);
 }
});
test('line-ending edits preserve untouched endings across insertion, deletion and multiple cursors',async()=>{
 const original='甲\r\n乙\n丙\r丁';const parsed=await parseText(original),state=EditorState.create({doc:parsed.doc});
 const changes=state.changes([{from:1,to:3,insert:'X\nY\n'},{from:6,insert:'Z\n'}]);const endings=editEndings(parsed.endings,state.doc,changes);const doc=changes.apply(state.doc);assert.equal(serializeText(doc,endings),'甲X\r\nY\r\n\n丙\rZ\r\n丁');
 const pasted=await parseText('新\n行\r\n尾');const insertion=state.changes({from:2,insert:pasted.doc});assert.equal(serializeText(insertion.apply(state.doc),editEndings(parsed.endings,state.doc,insertion,pasted.endings)),'甲\r\n新\n行\r\n尾乙\n丙\r丁');
});
test('loading yields and can be cancelled before constructing all content',async()=>{
 let turns=0;const timer=setInterval(()=>turns++,0);const result=await parseText('甲乙\r\n'.repeat(400000),()=>turns>3);clearInterval(timer);assert.equal(result,undefined);assert.ok(turns>3);
});
