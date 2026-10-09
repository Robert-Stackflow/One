#pragma once

// Helpers attach to the reservation made by their service before loading an
// archive engine. Keeping the mapping alive also preserves orphan reservations.
class ArchiveGlobalLease {
    void *value=nullptr;
public:
    ArchiveGlobalLease();
    ~ArchiveGlobalLease();
    ArchiveGlobalLease(const ArchiveGlobalLease&)=delete;
    ArchiveGlobalLease& operator=(const ArchiveGlobalLease&)=delete;
};
