#include <windows.h>
#include <cstdio>
#include <cinttypes>
#include <string>
#include "mz.h"
#include "mz_strm.h"
#include "mz_zip.h"
#include "mz_zip_rw.h"

// Exercise the low-level close API with descriptor output arguments; the GUI
// normally calls the high-level close API with these arguments absent.
static std::string utf8(const wchar_t *text){
    const int length=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text,-1,nullptr,0,nullptr,nullptr);
    if(length<=0)return {};std::string result(length,0);
    WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text,-1,result.data(),length,nullptr,nullptr);return result;
}
int wmain(int argc,wchar_t **argv){
    if(argc!=4)return 2;
    const int length=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,argv[1],-1,nullptr,0,nullptr,nullptr);
    if(length<=0)return 2;std::string path(length,0);WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,argv[1],-1,path.data(),length,nullptr,nullptr);
    void *reader=mz_zip_reader_create(),*zip=nullptr;if(!reader)return 2;
    int error=mz_zip_reader_open_file(reader,path.c_str());
    if(error==MZ_OK)error=mz_zip_reader_get_zip_handle(reader,&zip);
    if(error==MZ_OK)error=mz_zip_reader_goto_first_entry(reader);
    for(int i=0;i<_wtoi(argv[2])&&error==MZ_OK;i++)error=mz_zip_reader_goto_next_entry(reader);
    const std::string password=utf8(argv[3]);if(password.empty())return 2;
    if(error==MZ_OK)error=mz_zip_entry_read_open(zip,0,password.c_str());
    int64_t bytes=0,packed=0,size=0;uint32_t crc=0;
    if(error==MZ_OK){char buffer[4096];int count=0;while((count=mz_zip_entry_read(zip,buffer,sizeof(buffer)))>0)bytes+=count;
        const int closed=mz_zip_entry_read_close(zip,&crc,&packed,&size);error=count<0?count:closed;}
    std::printf("{\"error\":%d,\"read\":%" PRId64 ",\"crc\":%" PRIu32 ",\"packed\":%" PRId64 ",\"size\":%" PRId64 "}\n",error,bytes,crc,packed,size);
    mz_zip_reader_delete(&reader);return 0;
}
