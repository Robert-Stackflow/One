const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const path=require('node:path');

test('timestamp conversion handles units, zones and daylight saving transitions',async()=>{
 const outfile=path.resolve('work/current/timestamp.cjs');await build({entryPoints:['src/shared/timestamp.ts'],outfile,bundle:true,platform:'node',format:'cjs'});
 const {timestampToDate,dateToTimestamp,currentTimestamp}=require(outfile);
 assert.equal(timestampToDate('0','seconds','UTC').zoned,'1970-01-01 00:00:00.000');
 assert.equal(timestampToDate('0','milliseconds','Asia/Shanghai').zoned,'1970-01-01 08:00:00.000');
 assert.equal(timestampToDate('-1','milliseconds','UTC').seconds,'-0.001');
 assert.equal(timestampToDate('1.234','seconds','UTC').milliseconds,1234);
 assert.equal(dateToTimestamp('1970-01-01 08:00:00','Asia/Shanghai').milliseconds,0);
 assert.throws(()=>dateToTimestamp('2024-02-30 12:00','UTC'),/无效/);
 assert.throws(()=>dateToTimestamp('2024-03-10 02:30','America/New_York'),/不存在/);
 const earlier=dateToTimestamp('2024-11-03 01:30','America/New_York','earlier'),later=dateToTimestamp('2024-11-03 01:30','America/New_York','later');
 assert.equal(earlier.ambiguous,true);assert.equal(later.milliseconds-earlier.milliseconds,3600000);
 assert.equal(timestampToDate(String(earlier.milliseconds),'milliseconds','America/New_York').zoned,'2024-11-03 01:30:00.000');
 assert.ok(Math.abs(currentTimestamp('UTC').milliseconds-Date.now())<1000);
});
