#pragma once
#include <windows.h>
#include "common.h"
#include <memory>

// Private staging provenance. No cleanup authority comes from a directory
// name, filename or successful archive parsing alone.
namespace archive_stage {
class Recorder {
    struct Impl;
    std::unique_ptr<Impl> impl;
public:
    Recorder(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &revision);
    ~Recorder();
    Recorder(const Recorder&)=delete;
    // Restore the native cause after minizip has returned from its C callback.
    void rethrow_failure()const;
};
void created(const fs::path &path,HANDLE handle);
void seal();
}
