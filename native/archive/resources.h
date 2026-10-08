#pragma once
#include <windows.h>
#include "common.h"

// Options are supplied to each disposable helper, never to the GUI process.
struct ArchiveResourceOptions {unsigned level=6,threads=2,memory_mib=1024;};
const ArchiveResourceOptions &archive_resources();
class ArchiveResourceJob {
    HANDLE job=nullptr;
public:
    ArchiveResourceJob();
    ~ArchiveResourceJob(){if(job)CloseHandle(job);}
    ArchiveResourceJob(const ArchiveResourceJob&)=delete;
    ArchiveResourceJob& operator=(const ArchiveResourceJob&)=delete;
};
