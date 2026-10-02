#pragma once
#include <cstdint>
class CornerState {
 std::uintptr_t monitor=0;int corner=-1;std::uint64_t entered=0,last=0;bool consumed=false,triggered=false,suppression=false;
 public:
 void reset(){monitor=0;corner=-1;consumed=false;suppression=false;}
 void suppress(){suppression=true;}
 bool update(std::uintptr_t nextMonitor,int nextCorner,std::uint64_t now,int dwell,int cooldown){if(monitor!=nextMonitor||corner!=nextCorner){monitor=nextMonitor;corner=nextCorner;entered=now;consumed=false;}if(suppression){consumed=true;suppression=false;}if(nextCorner<0||consumed||now-entered<(unsigned)dwell||triggered&&now-last<(unsigned)cooldown)return false;consumed=true;triggered=true;last=now;return true;}
};
