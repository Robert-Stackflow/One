#pragma once
#include "common.h"
#include <memory>

// Snapshot and hold the original archive's source stream until staging is
// marked. Composite archives pass their original path, never the cached TAR.
class ArchiveOrigin {
    struct State;
    std::unique_ptr<State> state;
public:
    explicit ArchiveOrigin(const fs::path &source);
    ~ArchiveOrigin();
    ArchiveOrigin(const ArchiveOrigin&)=delete;
    unsigned zone() const;
    size_t apply(const fs::path &stage) const;
};
