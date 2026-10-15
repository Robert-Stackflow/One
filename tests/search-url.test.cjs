const {test,before}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild');
let url;
before(async()=>{const result=await build({entryPoints:['src/shared/search-url.ts'],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'warning'}),m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);url=m.exports;});
test('web addresses normalize full/bare/IDN/IP/localhost/port/path/query/fragment forms',()=>{
 for(const [value,expected]of [
  ['HTTPS://Example.com/a?x=1#part','https://example.com/a?x=1#part'],['example.com','https://example.com/'],['www.example.co.uk/a b','https://www.example.co.uk/a%20b'],['example.com:8443/path','https://example.com:8443/path'],['例子.中国/路径','https://xn--fsqu00a.xn--fiqs8s/%E8%B7%AF%E5%BE%84'],['192.168.1.2:8080/a','http://192.168.1.2:8080/a'],['127.0.0.1','http://127.0.0.1/'],['[::1]:3000/a','http://[::1]:3000/a'],['https://[2001:db8::1]/','https://[2001:db8::1]/'],['localhost:5173','http://localhost:5173/'],['例子。中国','https://xn--fsqu00a.xn--fiqs8s/'],['server:8080/a','http://server:8080/a'],['//example.com/a','https://example.com/a'],['https://intranet/a','https://intranet/a'],['https://example.com/a?url=https%3A%2F%2Fb.test#片段','https://example.com/a?url=https%3A%2F%2Fb.test#%E7%89%87%E6%AE%B5']
 ])assert.equal(url.searchUrl(value),expected,value);
 assert.equal(url.urlSearchEntry('example.com').launchKind,'url');
});
test('incomplete addresses, ordinary queries, local files and executable URI schemes are not browser actions',()=>{
 for(const value of ['',null,{},'搜索网页','word document','report.txt','document.pdf','file.exe','sample.msixbundle','.png','C:\\Files\\a.txt','D:/file.txt','\\\\server\\share','https://','www.','example..com','example.com:99999','999.1.2.3','javascript:alert(1)','javascript://example.com','data:text/html,<script>','file:///C:/Windows','one://page','ms-settings:','mailto:user@example.com','https://example.com/\nother','https://-bad.example/a'])assert.equal(url.searchUrl(value),null,String(value));
});
