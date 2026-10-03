const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild');
let transform;before(async()=>{const out=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','text-line-transform');await fs.mkdir(out,{recursive:true});await build({entryPoints:['src/shared/text.ts'],outfile:path.join(out,'text.cjs'),bundle:true,platform:'node',external:['opencc-js']});({transform}=require(path.join(out,'text.cjs')));});
function reference(text,operation){const lines=text.replace(/\r\n?/g,'\n').split('\n');switch(operation){case'clean':return lines.map(x=>x.trim()).filter(Boolean).join('\r\n');case'trim':return lines.map(x=>x.trim()).join('\r\n');case'empty':return lines.filter(x=>x.trim()).join('\r\n');case'paragraphSpace':return lines.filter(x=>x.trim()).join('\r\n\r\n');case'indent':return lines.map(x=>x.trim()?'\u3000\u3000'+x.trimStart():x).join('\r\n');case'layout':return lines.filter(x=>x.trim()).map(x=>'\u3000\u3000'+x.trim()).join('\r\n');case'unique':return[...new Set(lines)].join('\r\n');}}
const operations=['clean','trim','empty','paragraphSpace','indent','layout','unique'];
test('line transforms preserve mixed endings, trailing empty lines, Unicode whitespace and first occurrence order',()=>{
 const fixtures=['','\r','\n','\r\n','\n\r\r\n',' 甲 \r\n\n 乙\r 丙 ','🙂\r\n🙂\r甲\n','\uFEFF甲\u00a0\r\n\u0085\u200b\n','a\u2028b\r\u2029\n','\ud800\r\n\udc00',' '.repeat(70000)+'🙂\r\n尾','\r\n'.repeat(100000)];
 let seed=912387;const pieces=['甲','🙂','a','\t',' ','\u3000','\u00a0','\uFEFF','\u200b','\u2028','\r','\n','\r\n','\v','\f'];for(let n=0;n<500;n++){let text='';for(let i=0;i<80;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=pieces[seed%pieces.length];}fixtures.push(text);}
 for(const text of fixtures)for(const operation of operations)assert.equal(transform({operation,text}),reference(text,operation),operation+' / '+JSON.stringify(text.slice(0,100)));
});
test('output chunks preserve complete long lines and the separators between chunk boundaries',()=>{
 const text=Array.from({length:17000},(_,n)=>n%4===0?'':`  line ${n} 🙂  `).join('\r\n')+'\r尾\n';for(const operation of operations)assert.equal(transform({operation,text}),reference(text,operation),operation);
});
