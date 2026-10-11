const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const {resolve}=require('node:path');

test('RFC 4648 Base32 and Base64URL, hex and UTF-8 round trips',()=>{
 const output=resolve('work/current/text-codecs-unit.cjs');buildSync({entryPoints:['src/shared/text-codecs.ts'],outfile:output,bundle:true,platform:'node',target:'node22'});
 const {encodeText,decodeText}=require(output);
 for(const [plain,encoded] of [['',''],['f','MY======'],['fo','MZXQ===='],['foo','MZXW6==='],['foob','MZXW6YQ='],['fooba','MZXW6YTB'],['foobar','MZXW6YTBOI======']]){
  assert.equal(encodeText(plain,'base32'),encoded);assert.equal(decodeText(encoded,'base32'),plain);assert.equal(decodeText(encoded.replace(/=+$/,'').toLowerCase(),'base32'),plain);
 }
 const unicode='中文 🌄';
 for(const codec of ['base64','base64url','hex','base32'])assert.equal(decodeText(encodeText(unicode,codec),codec),unicode);
 assert.equal(encodeText(unicode,'base64url'),Buffer.from(unicode).toString('base64url'));
 assert.equal(encodeText('中文','hex'),'e4b8ade69687');assert.equal(decodeText('e4 b8 ad e6 96 87','hex'),'中文');
 assert.throws(()=>decodeText('0z','hex'),/第 2 个字符/);
 assert.throws(()=>decodeText('f','hex'),/偶数/);
 assert.throws(()=>decodeText('MZ======','base32'),/填充位/);
 assert.throws(()=>decodeText('MZXW6==','base32'),/填充/);
 assert.throws(()=>decodeText('%%','base64url'),/无效/);
 assert.throws(()=>decodeText('_w','base64url'),/UTF-8/);
 assert.equal(encodeText('&<>"\'','html'),'&amp;&lt;&gt;&quot;&apos;');
 assert.equal(decodeText('&copy; &#x1F600; &unknown;','html'),'© 😀 &unknown;');
 assert.equal(decodeText(encodeText(unicode,'html'),'html'),unicode);
 assert.equal(encodeText('A\n😀\\','unicode'),'A\\n\\u{1F600}\\\\');
 assert.equal(decodeText('A\\n\\u{1F600}\\\\','unicode'),'A\n😀\\');
 assert.equal(decodeText('\\uD83D\\uDE00','unicode'),'😀');
 assert.throws(()=>decodeText('\\uD800\\u0061','unicode'),/低位代理项/);
 assert.throws(()=>decodeText('hello \\q','unicode'),/第 7 个字符/);
 assert.throws(()=>decodeText('\\u{110000}','unicode'),/码点无效/);
});
