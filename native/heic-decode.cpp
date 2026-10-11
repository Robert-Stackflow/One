#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <cstdio>
#include <stdexcept>
using Microsoft::WRL::ComPtr;

static void check(HRESULT result,const char* step){
 if(FAILED(result)){std::fprintf(stderr,"%s: 0x%08lx\n",step,static_cast<unsigned long>(result));throw std::runtime_error(step);}
}

int wmain(int argc,wchar_t** argv){
 if(argc!=3)return 2;
 const HRESULT initialized=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
 if(FAILED(initialized))return 1;
 int code=0;
 try{{
  ComPtr<IWICImagingFactory> factory;
  check(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory)),"factory");
  ComPtr<IWICBitmapDecoder> decoder;
  check(factory->CreateDecoderFromFilename(argv[1],nullptr,GENERIC_READ,WICDecodeMetadataCacheOnDemand,&decoder),"decoder");
  UINT count=0;check(decoder->GetFrameCount(&count),"frame count");
  if(count!=1)throw std::runtime_error("Expected one primary frame");
  ComPtr<IWICBitmapFrameDecode> source;
  check(decoder->GetFrame(0,&source),"frame");
  UINT width=0,height=0;check(source->GetSize(&width,&height),"size");
  if(!width||!height||static_cast<unsigned long long>(width)*height>50000000)throw std::runtime_error("Image exceeds 50 MP limit");
  UINT contexts=0;check(source->GetColorContexts(0,nullptr,&contexts),"color contexts");
  if(contexts!=1)throw std::runtime_error("Expected one ICC color profile");
  ComPtr<IWICColorContext> color;
  check(factory->CreateColorContext(&color),"color context");
  IWICColorContext* context=color.Get();
  check(source->GetColorContexts(1,&context,&contexts),"read color profile");
  WICColorContextType type=WICColorContextUninitialized;
  check(color->GetType(&type),"profile type");
  if(type!=WICColorContextProfile)throw std::runtime_error("ICC color profile unavailable");
  ComPtr<IWICFormatConverter> pixels;
  check(factory->CreateFormatConverter(&pixels),"pixel converter");
  check(pixels->Initialize(source.Get(),GUID_WICPixelFormat32bppBGRA,WICBitmapDitherTypeNone,nullptr,0,WICBitmapPaletteTypeCustom),"convert pixels");
  ComPtr<IWICStream> output;
  check(factory->CreateStream(&output),"output stream");
  check(output->InitializeFromFilename(argv[2],GENERIC_WRITE),"output file");
  ComPtr<IWICBitmapEncoder> encoder;
  check(factory->CreateEncoder(GUID_ContainerFormatPng,nullptr,&encoder),"PNG encoder");
  check(encoder->Initialize(output.Get(),WICBitmapEncoderNoCache),"initialize PNG");
  ComPtr<IWICBitmapFrameEncode> frame;
  check(encoder->CreateNewFrame(&frame,nullptr),"output frame");
  check(frame->Initialize(nullptr),"initialize frame");
  check(frame->SetSize(width,height),"output size");
  WICPixelFormatGUID format=GUID_WICPixelFormat32bppBGRA;
  check(frame->SetPixelFormat(&format),"output pixel format");
  if(format!=GUID_WICPixelFormat32bppBGRA)throw std::runtime_error("PNG pixel format changed");
  check(frame->SetColorContexts(1,&context),"output ICC");
  check(frame->WriteSource(pixels.Get(),nullptr),"write pixels");
  check(frame->Commit(),"commit frame");
  check(encoder->Commit(),"commit PNG");
 }}catch(const std::exception& error){std::fprintf(stderr,"%s\n",error.what());code=1;}
 CoUninitialize();return code;
}
