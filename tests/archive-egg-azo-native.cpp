#include "../native/archive/egg-azo.h"
#include "../native/archive/common.h"
#include <fstream>
#include <iostream>
[[noreturn]] void fail(const std::string &message,const std::string &code){throw std::runtime_error(code+": "+message);}
int wmain(int argc,wchar_t **argv){
    try{
        if(argc!=5&&argc!=6)return 2;std::ifstream input(fs::path(argv[1]),std::ios::binary);std::ofstream output(fs::path(argv[2]),std::ios::binary);
        if(!input||!output)return 2;size_t checks=0,cancel=argc==6?std::stoull(argv[5]):0;
        egg_azo_decode([&](unsigned char *data,size_t count){if(!input.read((char*)data,count))fail("Unexpected end of test input");},
            [&](const unsigned char *data,size_t count){if(!output.write((const char*)data,count))fail("Test output write failed");},
            std::stoull(argv[3]),std::stoull(argv[4]),[&]{if(++checks==cancel)fail("Cancelled by test checkpoint","cancelled");});
        if(input.peek()!=std::ifstream::traits_type::eof())fail("Trailing test input");std::cout<<"AZO decoded; checkpoints="<<checks<<"\n";return 0;
    }catch(const std::exception &error){std::cerr<<error.what()<<"\n";return 1;}
}
