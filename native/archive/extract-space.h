#pragma once
#include "common.h"
#include <windows.h>
#include <atomic>
#include <mutex>

// A local estimate between quota-aware disk queries, not a volume reservation.
// The guard belongs to one extraction and is shared by its output streams.
class ExtractionSpace final {
public:
    using Probe=bool (*)(const fs::path&,uint64_t&,void*);
    using Clock=ULONGLONG (*)(void*);
    static constexpr uint64_t reserve=256ull*1024*1024;
    static constexpr uint64_t query_bytes=8ull*1024*1024;
    static constexpr ULONGLONG query_ms=250;
    ExtractionSpace(const fs::path &directory,uint64_t expected,Probe probe=nullptr,Clock clock=nullptr,void *context=nullptr);
    bool write(uint64_t bytes) noexcept;
    void require(uint64_t bytes);
    void finish();
    bool failed()const noexcept{return failure.load()!=Failure::none;}
    const char *message()const noexcept;
    const char *code()const noexcept;
private:
    enum class Failure {none,query,space,expanded,budget,time};
    fs::path directory;
    uint64_t expected=0,written=0,available=0,since_query=0;
    ULONGLONG last_query=0,started=0;uint64_t maximum_bytes=0,maximum_ms=0;
    Probe probe;Clock clock;void *context;
    std::mutex mutex;
    std::atomic<Failure> failure{Failure::none};
    bool test_cap=false;uint64_t test_after=0,test_available=0;
    bool refresh() noexcept;
};
