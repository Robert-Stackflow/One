using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using EggDotNet;
class Program {
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
   var entries=archive.Entries.Select(entry=>{
    using var contents=entry.Open();using var hash=SHA256.Create();var buffer=new byte[32768];long actual=0;int count;
    while(contents!=null&&(count=contents.Read(buffer,0,buffer.Length))>0){actual+=count;if(actual>64L*1024*1024)throw new InvalidDataException("Oracle fixture exceeded 64 MiB");hash.TransformBlock(buffer,0,count,null,0);}
    if(contents==null&&entry.UncompressedLength!=0)throw new InvalidDataException("Missing nonempty entry stream");
    hash.TransformFinalBlock(Array.Empty<byte>(),0,0);var digest=Convert.ToHexString(hash.Hash).ToLowerInvariant();
    return new { name=entry.FullName,size=entry.UncompressedLength,actual,encrypted=entry.IsEncrypted,method=entry.CompressionMethod.ToString(),sha256=digest };
   }).ToArray();
   Console.WriteLine(JsonSerializer.Serialize(new {solid=archive.IsSolid,split=archive.IsSplit,entries}));return 0;
  }catch(Exception error){Console.WriteLine(JsonSerializer.Serialize(new {error=error.GetType().Name,message=error.Message}));return 1;}
 }
}
