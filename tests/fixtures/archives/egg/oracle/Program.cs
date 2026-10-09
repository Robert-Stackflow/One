using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using EggDotNet;
class Program {
 static readonly uint[] CrcTable=BuildCrcTable();
 static uint[] BuildCrcTable(){var table=new uint[256];for(uint i=0;i<256;i++){uint value=i;for(int j=0;j<8;j++)value=(value&1)!=0?(value>>1)^0xedb88320u:value>>1;table[i]=value;}return table;}
 static uint UpdateCrc(uint value,byte[] bytes,int count){for(int i=0;i<count;i++)value=(value>>8)^CrcTable[(value^bytes[i])&255];return value;}
 static int Main(string[] args){
  try {
   System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
   using var stream=File.OpenRead(args[0]);
   var volumes=new System.Collections.Generic.List<Stream>();
   using var archive=new EggArchive(stream,false,initial=>{
    var sibling=Path.Combine(Path.GetDirectoryName(args[0]),"number.vol2.egg");
    if(!args[0].EndsWith("number.vol1.egg",StringComparison.OrdinalIgnoreCase)||!File.Exists(sibling))throw new InvalidDataException("Expected pinned second volume");
    volumes.Add(File.OpenRead(sibling));return volumes;
   },(filename,options)=>{options.Password=args.Length>1?args[1]:"password12345!";options.Retry=false;});
   uint solidCrc=0xffffffffu;uint? solidExpected=null;
   var entries=archive.Entries.Select(entry=>{
    using var contents=entry.Open();using var hash=SHA256.Create();var buffer=new byte[32768];long actual=0;int count;uint crc=0xffffffffu;
    while(contents!=null&&(count=contents.Read(buffer,0,buffer.Length))>0){actual+=count;if(actual>64L*1024*1024)throw new InvalidDataException("Oracle fixture exceeded 64 MiB");hash.TransformBlock(buffer,0,count,null,0);crc=UpdateCrc(crc,buffer,count);if(archive.IsSolid)solidCrc=UpdateCrc(solidCrc,buffer,count);}
    if(contents==null&&entry.UncompressedLength!=0)throw new InvalidDataException("Missing nonempty entry stream");
    if(actual>0){if(archive.IsSolid)solidExpected??=entry.Crc32;else if((crc^0xffffffffu)!=entry.Crc32)throw new InvalidDataException("Reference CRC mismatch: "+entry.FullName);}
    hash.TransformFinalBlock(Array.Empty<byte>(),0,0);var digest=Convert.ToHexString(hash.Hash).ToLowerInvariant();
    return new { name=entry.FullName,size=entry.UncompressedLength,actual,encrypted=entry.IsEncrypted,method=entry.CompressionMethod.ToString(),sha256=digest };
   }).ToArray();
   if(solidExpected.HasValue&&(solidCrc^0xffffffffu)!=solidExpected.Value)throw new InvalidDataException("Reference solid CRC mismatch");
   Console.WriteLine(JsonSerializer.Serialize(new {solid=archive.IsSolid,split=archive.IsSplit,entries}));return 0;
  }catch(Exception error){Console.WriteLine(JsonSerializer.Serialize(new {error=error.GetType().Name,message=error.Message}));return 1;}
 }
}
