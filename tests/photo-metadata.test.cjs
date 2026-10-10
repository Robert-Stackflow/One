const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),exifr=require('exifr');
const ready=(async()=>{const dir=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/current/image-preview/photo-metadata');await fs.mkdir(dir,{recursive:true});const outfile=path.join(dir,'metadata.cjs');await build({entryPoints:['src/shared/photo-metadata.ts'],outfile,bundle:true,platform:'node'});return require(outfile);})();
test('flash bit fields distinguish fired, disabled, automatic, red-eye and unavailable',async()=>{
 const {photoMetadata}=await ready;for(const [value,expected] of [[0,'未闪光'],[1,'已闪光'],[16,'未闪光 · 关闭'],[24,'未闪光 · 自动'],[32,'无闪光灯'],[89,'已闪光 · 自动 · 防红眼']])assert.equal(photoMetadata({Flash:value}).metadata['闪光灯'],expected);assert.equal(photoMetadata({}).metadata['闪光灯'],undefined);
});
test('real EXIF parsing preserves exposure units, camera local timestamp and southern/western GPS',async()=>{
 const {photoMetadata}=await ready,data=await exifr.parse('tests/fixtures/image-preview/metadata.jpg',{gps:true,exif:true,tiff:true,translateValues:false,reviveValues:false}),result=photoMetadata(data);
 assert.equal(result.metadata['曝光时间'],'1/125 秒');assert.equal(result.metadata['光圈'],'f/2.8');assert.equal(result.metadata['闪光灯'],'已闪光 · 自动 · 防红眼');assert.equal(result.metadata['拍摄时间'],'2025-10-06 09:20:35.125 +08:00');assert.equal(result.metadata['白平衡'],'自动');assert.equal(result.metadata['海拔'],'-12.5 m');assert.ok(Math.abs(result.location.latitude+33.8666666667)<1e-6);assert.ok(Math.abs(result.location.longitude+151.2)<1e-6);
});
test('stored place names and XMP degree-minute values work without fabricating a street address',async()=>{
 const {photoMetadata}=await ready,result=photoMetadata({City:'测试城市',Country:'测试国家',GPSLatitude:'30,30N',GPSLongitude:'114,15E'});assert.equal(result.metadata['拍摄地点'],'测试城市 · 测试国家');assert.deepEqual(result.location,{latitude:30.5,longitude:114.25});assert.equal(photoMetadata({latitude:0,longitude:0}).metadata['GPS 坐标'],'0° N，0° E');assert.equal(photoMetadata({latitude:181,longitude:999}).location,undefined);assert.equal(photoMetadata({GPSLatitude:[30,80,0],GPSLongitude:[114,15,0]}).location,undefined);assert.equal(photoMetadata({latitude:30,longitude:114}).metadata['拍摄地点'],undefined);
});
test('missing, non-finite and oversized text values do not create invented metadata',async()=>{
 const {photoMetadata}=await ready;assert.deepEqual(photoMetadata({}),{metadata:{},location:undefined});assert.equal(photoMetadata({ISO:NaN,latitude:Infinity,longitude:1}).location,undefined);assert.equal(photoMetadata({Make:'x'.repeat(10000)}).metadata['设备品牌'].length,240);assert.equal(photoMetadata({DateTimeOriginal:'2025-10-06T09:20:35.123+08:00',SubSecTimeOriginal:'123',OffsetTimeOriginal:'+08:00'}).metadata['拍摄时间'],'2025-10-06T09:20:35.123+08:00');
});
