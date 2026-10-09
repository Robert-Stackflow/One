#pragma once
#include <windows.h>
#include <thread>

// Activity is updated by real I/O/engine progress, not the heartbeat timer.
void archive_activity();
class ArchiveHeartbeat {
    HANDLE stop=nullptr;
    std::thread worker;
public:
    ArchiveHeartbeat();
    ~ArchiveHeartbeat();
    ArchiveHeartbeat(const ArchiveHeartbeat&)=delete;
    ArchiveHeartbeat& operator=(const ArchiveHeartbeat&)=delete;
};
