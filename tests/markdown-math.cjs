const {build}=require('esbuild'),{Marked}=require('marked'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'math-tokens-'));try{
  const file=path.join(directory,'tokens.cjs');await build({entryPoints:['src/shared/markdown-math.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',logLevel:'warning'});const {markedMath}=require(file);
  const parse=source=>{const tokens=[],math=markedMath(),parser=new Marked();parser.use({...math,extensions:math.extensions.map(value=>({...value,renderer(token){tokens.push({text:token.text,display:token.displayMode});return '<span>math</span>';}}))});parser.parse(source);return tokens;};
  assert.deepEqual(parse('Inline $x+1$, then $$a=b$$.'),[{text:'x+1',display:false},{text:'a=b',display:true}]);
  assert.deepEqual(parse('$$\n\\frac{a}{b}\n$$'),[{text:String.raw`\frac{a}{b}`,display:true}]);
  assert.deepEqual(parse('Cost $5.00 and $x+1$.'),[{text:'x+1',display:false}]);assert.deepEqual(parse('escaped \\$x$ and code `$a$`'),[]);
  assert.deepEqual(parse('```tex\n$x$\n```'),[]);assert.deepEqual(parse('$unclosed'),[]);assert.deepEqual(parse(String.raw`$a+\$b$`),[{text:String.raw`a+\$b`,display:false}]);
  console.log('Markdown math tokens: inline/display, escaped dollars, currency, code fences, unmatched input and current KaTeX-independent integration passed.');
}finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('math-tokens-'));await fs.rm(actual,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
