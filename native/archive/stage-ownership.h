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
// Own the transition until the complete publication plan has been flushed and
// renamed without replacement. The original stage journal remains recoverable.
class Handoff {
    struct Impl;
    std::unique_ptr<Impl> impl;
public:
    Handoff(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &revision);
    ~Handoff();
    Handoff(const Handoff&)=delete;
    void member(const fs::path &path,const std::string &stamp)const;
    void release_outputs();
    HANDLE take_pending();
    void publish(HANDLE manifest);
    void retire();
};
// Return a delete-capable lock only when a surviving stage journal records the
// exact identity of this publication manifest. Caller owns the returned handle.
HANDLE lock_published_journal(const fs::path &source,const fs::path &stage,const fs::path &recovery,HANDLE manifest);
}
