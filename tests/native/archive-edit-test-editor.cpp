#include <windows.h>
#include <filesystem>
#include <fstream>
#include <string>
namespace fs=std::filesystem;
// A harmless real editor process. Tests control exit through a separate folder;
// no backup/control files are written beside the user's document.
int wmain(int argc,wchar_t** argv){
 if(argc!=2)return 2;
 wchar_t directory[32768]{};const auto count=GetEnvironmentVariableW(L"ONE_ARCHIVE_EDIT_TEST_CONTROL",directory,32768);if(!count||count>=32768)return 3;
 const fs::path root(directory);const auto pid=std::to_string(GetCurrentProcessId());
 const std::wstring input(argv[1]);const int size=WideCharToMultiByte(CP_UTF8,0,input.data(),static_cast<int>(input.size()),nullptr,0,nullptr,nullptr);std::string name(size,0);WideCharToMultiByte(CP_UTF8,0,input.data(),static_cast<int>(input.size()),name.data(),size,nullptr,nullptr);
 {std::ofstream opened(root/(pid+".opened"),std::ios::binary);opened<<name;}
 for(unsigned i=0;i<6000&&!fs::exists(root/(pid+".close"));++i)Sleep(25);
 return 0;
}
