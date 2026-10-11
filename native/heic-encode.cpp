#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <cstdio>
#include <stdexcept>
#include <string>
using Microsoft::WRL::ComPtr;

static void check(HRESULT result,const char* step){
 if(FAILED(result)){std::fprintf(stderr,"%s: 0x%08lx\n",step,static_cast<unsigned long>(result));throw std::runtime_error(step);}
}

static void encode(const wchar_t* input,const wchar_t* output,int quality){
 ComPtr<IWICImagingFactory> factory;
 check(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory)),"factory");
 ComPtr<IWICBitmapDecoder> decoder;
 check(factory->CreateDecoderFromFilename(input,nullptr,GENERIC_READ,WICDecodeMetadataCacheOnDemand,&decoder),"decoder");
 UINT frames=0;check(decoder->GetFrameCount(&frames),"frame count");
 if(frames!=1)throw std::runtime_error("Expected one frame");
 ComPtr<IWICBitmapFrameDecode> source;
 check(decoder->GetFrame(0,&source),"source frame");
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
 ComPtr<IWICStream> stream;
 check(factory->CreateStream(&stream),"output stream");
 check(stream->InitializeFromFilename(output,GENERIC_WRITE),"output file");
 ComPtr<IWICBitmapEncoder> encoder;
 check(factory->CreateEncoder(GUID_ContainerFormatHeif,nullptr,&encoder),"HEIF encoder");
 check(encoder->Initialize(stream.Get(),WICBitmapEncoderNoCache),"initialize HEIF");
 ComPtr<IWICBitmapFrameEncode> frame;ComPtr<IPropertyBag2> properties;
 check(encoder->CreateNewFrame(&frame,&properties),"output frame");
 PROPBAG2 compression{};compression.pstrName=const_cast<LPOLESTR>(L"HeifCompressionMethod");
 VARIANT method;VariantInit(&method);method.vt=VT_UI1;method.bVal=static_cast<BYTE>(WICHeifCompressionHEVC);
 check(properties->Write(1,&compression,&method),"HEVC compression");
 PROPBAG2 imageQuality{};imageQuality.pstrName=const_cast<LPOLESTR>(L"ImageQuality");
 VARIANT qualityValue;VariantInit(&qualityValue);qualityValue.vt=VT_R4;qualityValue.fltVal=quality/100.0f;
 check(properties->Write(1,&imageQuality,&qualityValue),"image quality");
 check(frame->Initialize(properties.Get()),"initialize frame");
 check(frame->SetSize(width,height),"output size");
 WICPixelFormatGUID pixels=GUID_WICPixelFormat24bppBGR;
 check(frame->SetPixelFormat(&pixels),"output pixel format");
 check(frame->SetColorContexts(1,&context),"output ICC");
 check(frame->WriteSource(source.Get(),nullptr),"write pixels");
 check(frame->Commit(),"commit frame");
 check(encoder->Commit(),"commit HEIC");
}

int wmain(int argc,wchar_t** argv){
 if(argc!=4)return 2;
 const int quality=_wtoi(argv[3]);
 if(quality<1||quality>100)return 2;
 const HRESULT initialized=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
 if(FAILED(initialized))return 1;
 int code=0;
 try{encode(argv[1],argv[2],quality);}catch(const std::exception& error){std::fprintf(stderr,"%s\n",error.what());code=1;}
 CoUninitialize();return code;
}
