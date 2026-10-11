const assert=require('node:assert/strict');
const {mkdtemp,readFile,rm,mkdir}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const sharp=require('sharp');
const {ImageMetadataService}=require('../dist/main/image-metadata-service.cjs');
const exiftool=require('exiftool-vendored.exe');

function tags(path){const result=spawnSync(exiftool,['-j','-G1','-a','-s','-n','-EXIF:all','-GPS:all','-XMP:all','-IPTC:all',path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout)[0];}
function edit(path,args){const result=spawnSync(exiftool,['-overwrite_original',...args,path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);}

(async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-metadata-')),out=join(root,'out');await mkdir(out);
 try{
  const source=join(root,'sample.jpg');await sharp({create:{width:3,height:2,channels:3,background:'#e35277'}}).jpeg().withIccProfile('p3').toFile(source);
  edit(source,['-Orientation#=6','-Artist=Test Artist','-GPSLatitude=12.34','-GPSLatitudeRef=N','-GPSLongitude=56.78','-GPSLongitudeRef=E','-XMP-dc:Description=Private XMP','-XMP-exif:GPSLatitude=12.34','-XMP-exif:GPSLongitude=56.78','-IPTC:Keywords=Private IPTC']);
  const original=await readFile(source),sourceInfo=await sharp(source).metadata();assert(sourceInfo.icc?.length>0);assert.equal(sourceInfo.orientation,6);
  const service=new ImageMetadataService();
  const all=await service.start(1,[source],out,{removeExif:true,removeGps:true,removeXmp:true,removeIptc:true},()=>{});assert.equal(all.results[0].status,'done',all.results[0].message);
  const diff=all.results[0].metadataDiff;assert(diff?.count>0);assert(!diff.changes.some(change=>change.tag==='SourceFile'));const artist=diff.changes.find(change=>change.tag.endsWith(':Artist'));assert.equal(artist?.before,'Test Artist');assert.equal(artist?.after,undefined);
  const cleaned=all.results[0].output,after=await sharp(cleaned).metadata(),removed=tags(cleaned);assert.equal(after.width,2);assert.equal(after.height,3);assert.equal(after.orientation,undefined);assert(after.icc.equals(sourceInfo.icc));assert(!Object.keys(removed).some(key=>/^(IFD\d*|ExifIFD|GPS|InteropIFD|MakerNotes|SubIFD|XMP[-:]|IPTC:)/.test(key)),JSON.stringify(removed));
  const gps=await service.start(2,[source],out,{removeExif:false,removeGps:true,removeXmp:false,removeIptc:false},()=>{});assert.equal(gps.results[0].status,'done',gps.results[0].message);const gpsTags=tags(gps.results[0].output);assert.equal(gpsTags['IFD0:Artist'],'Test Artist');assert.equal(gpsTags['IFD0:Orientation'],6);assert(!Object.keys(gpsTags).some(key=>/^GPS:|^XMP-.*:(GPS|Geotag)/i.test(key)));assert(Object.keys(gpsTags).some(key=>/^XMP-/.test(key)));assert(Object.keys(gpsTags).some(key=>/^IPTC:/.test(key)));
  const exifGps=await service.start(4,[source],out,{removeExif:true,removeGps:true,removeXmp:false,removeIptc:false},()=>{});assert.equal(exifGps.results[0].status,'done',exifGps.results[0].message);const exifGpsTags=tags(exifGps.results[0].output);assert(!Object.keys(exifGpsTags).some(key=>/^GPS:|^XMP-.*:(GPS|Geotag)/i.test(key)));assert(Object.keys(exifGpsTags).some(key=>/^XMP-/.test(key)));assert(Object.keys(exifGpsTags).some(key=>/^IPTC:/.test(key)));
  assert((await readFile(source)).equals(original));assert.equal(service.pendingTasks,false);
  for(const format of ['png','webp','gif','tiff']){
   const file=join(root,`plain.${format}`);await sharp({create:{width:4,height:3,channels:3,background:'#5791bd'}}).toFormat(format).toFile(file);
   if(format!=='gif')edit(file,['-Artist=Private Artist']);
   const summary=await service.start(3,[file],out,{removeExif:true,removeGps:true,removeXmp:true,removeIptc:true},()=>{});
   assert.equal(summary.results[0].status,'done',`${format}: ${summary.results[0].message}`);
   assert.equal((await sharp(summary.results[0].output).metadata()).format,format);
   assert(!Object.keys(tags(summary.results[0].output)).some(key=>key.endsWith(':Artist')));
  }
  const motionDir=join(root,'motion');await require('./image-preview-fixtures.cjs').fixtures(motionDir);
  const motion=await service.start(5,[join(motionDir,'google-old.jpg')],out,{removeExif:true,removeGps:true,removeXmp:true,removeIptc:true},()=>{});
  assert.equal(motion.results[0].status,'error');assert.match(motion.results[0].message,/动态照片/);
  console.log('Image metadata: selective removal, orientation, ICC, source integrity OK');
 }finally{await rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
