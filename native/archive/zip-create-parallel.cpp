#include "zip-create-parallel.h"
#include "resources.h"
#include "heartbeat.h"
#include "update-common.h"
#include "recovery-common.h"
#include "mz.h"
#include "mz_strm.h"
#include "mz_os.h"
#include "mz_zip.h"
#include "mz_zip_rw.h"
#include <future>
#include <memory>

namespace {
struct Writer {
 void *value=mz_zip_writer_create();
 Writer(){if(!value)fail("Cannot initialize parallel ZIP writer","resource");}
 ~Writer(){mz_zip_writer_delete(&value);}
};
struct Reader {
 void *value=mz_zip_reader_create();
 explicit Reader(const fs::path &path){if(!value)fail("Cannot initialize ZIP part reader","resource");if(mz_zip_reader_open_file(value,utf8(path.wstring()).c_str())!=MZ_OK){mz_zip_reader_delete(&value);fail("Cannot read compressed ZIP part");}}
 ~Reader(){mz_zip_reader_delete(&value);}
};
void checked(int status){if(status!=MZ_OK)fail("Cannot assemble parallel ZIP (engine "+std::to_string(status)+")",status==MZ_MEM_ERROR?"resource":status==MZ_WRITE_ERROR?"write":status==MZ_READ_ERROR?"read":"archive");}
struct Item {fs::path source;std::string name;bool directory;};
// Only this invocation's explicitly created part paths are removed, never
// recursive unknown content. The service also owns this directory on cancel.
struct Parts {
 fs::path root;std::vector<fs::path> paths;
 ~Parts(){for(const auto &path:paths){std::error_code ignored;fs::remove(path,ignored);}}
};
void compress(const Item &item,const fs::path &part,const std::string &password){
 archive_update::check_source(item.source);
 archive_update::File source(item.source,GENERIC_READ,FILE_SHARE_READ);
 const auto stamp=archive_update::stamp(source.handle);
 Writer writer;
 mz_zip_writer_set_progress_cb(writer.value,nullptr,[](void*,void*,mz_zip_file*,int64_t)->int32_t{archive_activity();return MZ_OK;});
 mz_zip_writer_set_follow_links(writer.value,0);mz_zip_writer_set_store_links(writer.value,0);
 const auto &options=archive_resources();
 mz_zip_writer_set_compress_level(writer.value,(int16_t)options.level);
 mz_zip_writer_set_compress_method(writer.value,options.level==0?MZ_COMPRESS_METHOD_STORE:options.zip_method);
 mz_zip_writer_set_aes(writer.value,(uint8_t)options.zip_aes);
 if(!password.empty())mz_zip_writer_set_password(writer.value,password.c_str());
 checked(mz_zip_writer_open_file_exclusive(writer.value,utf8(part.wstring()).c_str(),0));
 checked(mz_zip_writer_add_file(writer.value,utf8(item.source.wstring()).c_str(),item.name.c_str()));
 checked(mz_zip_writer_close(writer.value));
 if(archive_update::stamp(source.handle)!=stamp)fail("ZIP source changed during compression");
}
}

bool zip_create_parallel(const fs::path &destination,const std::vector<fs::path> &sources,const std::string &password,int64_t volume_size){
 wchar_t directory[32768]{};const auto length=GetEnvironmentVariableW(L"ONE_ARCHIVE_ZIP_WORK_DIR",directory,32768);
 if(archive_resources().threads<2||!length)return false;
 if(length>=32768)fail("Invalid parallel ZIP work directory");
 const fs::path root=fs::absolute(directory).lexically_normal();
 if(root.parent_path()!=fs::absolute(destination).lexically_normal().parent_path()||!root.filename().wstring().starts_with(L".one-archive-")||!root.filename().wstring().ends_with(L"-stage"))fail("Invalid parallel ZIP work scope");
 std::vector<Item> items;size_t files=0;
 auto add=[&](const fs::path &path,const fs::path &base){
  archive_update::check_source(path);const auto status=fs::symlink_status(path);const bool dir=fs::is_directory(status);
  if(!dir&&!fs::is_regular_file(status))fail("Source contains an unsupported file");
  auto name=utf8(path.lexically_relative(base).generic_wstring());if(dir)name+='/';
  if(!safe_entry(name,dir))fail("Unsafe ZIP source path","safety");
  items.push_back({path,name,dir});if(!dir)++files;if(items.size()>1000000)fail("Too many archive entries");
 };
 for(const auto &source:sources){add(source,source.parent_path());if(fs::is_directory(source))for(const auto &entry:fs::recursive_directory_iterator(source,fs::directory_options::none))add(entry.path(),source.parent_path());}
 if(files<2)return false;
 archive_recovery::Directories directories;directories.ancestors(root);
 if(!fs::is_empty(root))fail("Parallel ZIP work directory is not empty","write");
 Parts parts{root};Writer writer;
 mz_zip_writer_set_progress_cb(writer.value,nullptr,[](void*,void*,mz_zip_file*,int64_t)->int32_t{archive_activity();return MZ_OK;});
 checked(mz_zip_writer_open_file_exclusive(writer.value,utf8(destination.wstring()).c_str(),volume_size));
 const auto workers=std::min<size_t>(archive_resources().threads,files);
 size_t cursor=0,done=0;
 while(cursor<items.size()){
  struct Pending{size_t index;fs::path path;std::future<void> task;};std::vector<Pending> pending;
  while(cursor<items.size()&&pending.size()<workers){
   const auto index=cursor++;const auto &item=items[index];
   if(item.directory){mz_zip_file info{};info.version_madeby=MZ_VERSION_MADEBY;info.filename=item.name.c_str();info.flag=MZ_ZIP_FLAG_UTF8;info.external_fa=FILE_ATTRIBUTE_DIRECTORY;checked(mz_zip_writer_add_info(writer.value,nullptr,nullptr,&info));++done;continue;}
   const auto path=root/(std::to_wstring(index)+L".zip");parts.paths.push_back(path);
   pending.push_back({index,path,std::async(std::launch::async,[&,index,path]{compress(items[index],path,password);})});
  }
  for(auto &part:pending){part.task.get();archive_update::File lock(part.path,GENERIC_READ,FILE_SHARE_READ);Reader reader(part.path);
   checked(mz_zip_reader_goto_first_entry(reader.value));checked(mz_zip_writer_copy_from_reader(writer.value,reader.value));++done;
   emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(items.size())+"}");
  }
  pending.clear();for(const auto &path:parts.paths){std::error_code error;fs::remove(path,error);if(error)fail("Cannot release parallel ZIP part","write");}parts.paths.clear();
 }
 checked(mz_zip_writer_close(writer.value));
 emit("{\"type\":\"result\",\"count\":"+std::to_string(sources.size())+"}");return true;
}
