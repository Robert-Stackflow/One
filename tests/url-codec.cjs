const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');

test('URL and parameter modes preserve their distinct separators and reject invalid encodings',async()=>{
 const outfile=path.resolve('work/current/url-codec.cjs');await build({entryPoints:['src/shared/url-codec.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 const {transformURL:run}=require(outfile),url='https://example.com/路径?q=中文 空格&x=1';
 assert.equal(run(url,'url','encode'),'https://example.com/%E8%B7%AF%E5%BE%84?q=%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC&x=1');
 assert.equal(run(run(url,'url','encode'),'url','decode'),url);
 assert.equal(run('a+b &c','parameter','encode'),'a%2Bb%20%26c');
 assert.equal(run('a+b%2Bc','parameter','decode'),'a b+c');
 assert.throws(()=>run('%E4%A','parameter','decode'),/无效/);
 assert.throws(()=>run('\ud800','url','encode'),/无法编码/);
 assert.throws(()=>run('x'.repeat(2*1024*1024+1),'url','encode'),/2 MB/);
 assert.throws(()=>run('中'.repeat(1_200_000),'parameter','encode'),/10 MB/);
});
