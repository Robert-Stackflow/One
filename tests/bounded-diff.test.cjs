const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{buildSync}=require('esbuild');
const root=path.resolve('work/bounded-diff-tests');fs.mkdirSync(root,{recursive:true});
const bundle=path.join(root,'comparison.cjs');buildSync({stdin:{contents:"export {compareTextLines} from './src/main/bounded-diff';export {textDiffRows} from './src/main/text-diff';",resolveDir:path.resolve('.')},outfile:bundle,bundle:true,platform:'node'});
const {compareTextLines,textDiffRows}=require(bundle);
const rebuild=(changes,side)=>changes.filter(c=>side==='left'?!c.added:!c.removed).map(c=>c.value).join('');
const verify=(left,right,result)=>{assert.equal(rebuild(result.changes,'left'),left.replace(/\r\n/g,'\n'));assert.equal(rebuild(result.changes,'right'),right.replace(/\r\n/g,'\n'));};

test('bounded diff preserves edits, CRLF, repeated/moved lines and end-of-file newline',()=>{
 for(const [left,right]of [['',''],['','\n'],['a\n','a'],['a\r\nb\r\n','a\nc\n'],['x\nx\ny\n','y\nx\nx\n'],['a\n\n','\na\n']])verify(left,right,compareTextLines(left,right,false));
 let seed=31;const rand=n=>(seed=(seed*1664525+1013904223)>>>0)%n;
 for(let n=0;n<40;n++){const left=Array.from({length:100},()=>String(rand(15))+'\n').join(''),right=Array.from({length:rand(130)},()=>String(rand(15))+'\n').join('');verify(left,right,compareTextLines(left,right,false));}
 assert.equal(textDiffRows(compareTextLines(' a\n\tb\r\n','a\nb\n',true).changes).rows.length,0);
});

test('dense rewrites return complete blocks instead of timing out, retaining common anchors',()=>{
 const content=side=>Array.from({length:5000},(_,i)=>i%50===0?`anchor ${i}\n`:`${side} ${i}\n`).join('');
 const left=content('old'),right=content('new'),comparison=compareTextLines(left,right,false);verify(left,right,comparison);assert.equal(comparison.grouped,true);
 const result=textDiffRows(comparison.changes);assert.equal(result.stats.addedLines,4900);assert.equal(result.stats.removedLines,4900);assert.equal(result.stats.leftLines,5000);assert.equal(result.stats.rightLines,5000);
 assert.ok(result.rows.length>0);assert.ok(result.rows.every(r=>r.leftText.length<=16000&&r.rightText.length<=16000));
});

test('large sampled-anchor comparison preserves moved and duplicate contents in order',()=>{
 const common='common contents '.repeat(3)+'\n';
 const left=Array.from({length:30000},(_,i)=>i%7?`left ${i} ${'x'.repeat(55)}\n`:common).join('');
 const right=Array.from({length:31000},(_,i)=>i%11?`right ${i} ${'y'.repeat(55)}\n`:common).join('');
 const comparison=compareTextLines(left,right,false);assert.equal(comparison.grouped,true);verify(left,right,comparison);
});

test('large ignored whitespace and CRLF use the same equality rules as precise comparison',()=>{
 const left=Array.from({length:35000},(_,i)=>`  line ${i} ${'contents '.repeat(5)} \r\n`).join(''),right=left.replace(/\r\n/g,'\n').split('\n').map(s=>s.trim()).join('\n');
 const result=compareTextLines(left,right,true);assert.equal(result.grouped,true);assert.equal(textDiffRows(result.changes).rows.length,0);
});

test('millions of short lines avoid token arrays and preserve precise common edges',()=>{
 const left='same\n'+'\n'.repeat(1000000)+'old\n'+'tail\n',right='same\n'+'\n'.repeat(1000000)+'new\n'+'tail\n';
 const comparison=compareTextLines(left,right,false);verify(left,right,comparison);const result=textDiffRows(comparison.changes);assert.equal(result.rows.length,1);assert.equal(result.rows[0].oldLine,1000002);assert.equal(result.stats.addedLines,1);
 const ignored=compareTextLines(' '+left,right,true);assert.equal(textDiffRows(ignored.changes).stats.addedLines,1);
});

test('split change records retain every character, advancing line numbers and Unicode pairs',()=>{
 const left=Array.from({length:181},(_,i)=>`old ${i}\n`).join(''),right='z'.repeat(15999)+'😀'+'z'.repeat(9000)+'\n';
 const rows=textDiffRows([{removed:true,count:181,value:left},{added:true,count:1,value:right}]).rows;
 assert.equal(rows.map(r=>r.leftText).join(''),left);assert.equal(rows.map(r=>r.rightText).join(''),right);assert.equal(rows[1].oldLine,81);assert.equal(rows[2].oldLine,161);assert.equal(rows[1].newLine,1);
 for(const row of rows){assert.ok(row.leftText.length<=16000&&row.rightText.length<=16000);assert.ok(!/[\ud800-\udbff]$/.test(row.rightText));assert.ok(!/^[\udc00-\udfff]/.test(row.rightText));}
});
