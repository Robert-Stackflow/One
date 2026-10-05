#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <io.h>
#include <fcntl.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

void thumbnail(const wchar_t* path,unsigned maxWidth,unsigned maxHeight){
  if(!maxWidth||!maxHeight||maxWidth>1280||maxHeight>960)throw std::runtime_error("Invalid thumbnail dimensions");
  Gdiplus::GdiplusStartupInput startup;ULONG_PTR token=0;
  if(Gdiplus::GdiplusStartup(&token,&startup,nullptr)!=Gdiplus::Ok)throw std::runtime_error("Image decoder unavailable");
  try{
    Gdiplus::Bitmap source(path,FALSE);
    const auto sourceWidth=source.GetWidth(),sourceHeight=source.GetHeight();
    if(source.GetLastStatus()!=Gdiplus::Ok||!sourceWidth||!sourceHeight||static_cast<unsigned long long>(sourceWidth)*sourceHeight>100000000)throw std::runtime_error("Image is too large or unavailable");
    const double scale=std::min({double(maxWidth)/sourceWidth,double(maxHeight)/sourceHeight,1.0});
    const auto width=std::max(1u,static_cast<unsigned>(std::round(sourceWidth*scale))),height=std::max(1u,static_cast<unsigned>(std::round(sourceHeight*scale)));
    Gdiplus::Bitmap output(width,height,PixelFormat32bppARGB);
    Gdiplus::Graphics graphics(&output);
    graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
    graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);
    graphics.SetCompositingMode(Gdiplus::CompositingModeSourceCopy);
    if(graphics.DrawImage(&source,Gdiplus::Rect(0,0,width,height),0,0,sourceWidth,sourceHeight,Gdiplus::UnitPixel)!=Gdiplus::Ok)throw std::runtime_error("Image scaling failed");
    UINT count=0,size=0;Gdiplus::GetImageEncodersSize(&count,&size);if(!count||!size)throw std::runtime_error("PNG encoder unavailable");
    std::vector<BYTE> codecs(size);if(Gdiplus::GetImageEncoders(count,size,reinterpret_cast<Gdiplus::ImageCodecInfo*>(codecs.data()))!=Gdiplus::Ok)throw std::runtime_error("PNG encoder unavailable");
    CLSID encoder{};bool found=false;auto entries=reinterpret_cast<Gdiplus::ImageCodecInfo*>(codecs.data());
    for(UINT i=0;i<count;i++)if(wcscmp(entries[i].MimeType,L"image/png")==0){encoder=entries[i].Clsid;found=true;break;}
    if(!found)throw std::runtime_error("PNG encoder unavailable");
    IStream* stream=nullptr;if(FAILED(CreateStreamOnHGlobal(nullptr,TRUE,&stream)))throw std::runtime_error("Image buffer unavailable");
    const auto saved=output.Save(stream,&encoder);STATSTG info{};const auto stated=stream->Stat(&info,STATFLAG_NONAME);
    HGLOBAL memory=nullptr;const auto received=GetHGlobalFromStream(stream,&memory);
    if(saved!=Gdiplus::Ok||FAILED(stated)||FAILED(received)||!memory||info.cbSize.QuadPart<=0||info.cbSize.QuadPart>8*1024*1024){stream->Release();throw std::runtime_error("Thumbnail encoding failed");}
    const auto bytes=GlobalLock(memory);if(!bytes){stream->Release();throw std::runtime_error("Thumbnail buffer unavailable");}
    if(_setmode(_fileno(stdout),_O_BINARY)<0){GlobalUnlock(memory);stream->Release();throw std::runtime_error("Binary output unavailable");}
    std::cout.write(static_cast<const char*>(bytes),static_cast<std::streamsize>(info.cbSize.QuadPart));std::cout.flush();
    GlobalUnlock(memory);stream->Release();
  }catch(...){Gdiplus::GdiplusShutdown(token);throw;}
  Gdiplus::GdiplusShutdown(token);
}

int wmain(int argc,wchar_t** argv){
  try{
    if(argc!=4)throw std::runtime_error("Invalid arguments");
    thumbnail(argv[1],std::stoul(argv[2]),std::stoul(argv[3]));
    return 0;
  }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
