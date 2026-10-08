#pragma once
#include <windows.h>
#include <propidl.h>
#include <functional>
#include "update-common.h"

// Query IOutArchive on the opened reader so the SDK can copy packed blocks.
void seven_rewrite(IUnknown *original,const fs::path &destination,
                   const std::vector<archive_update::OutputEntry> &nodes,
                   const std::vector<std::string> &names,const std::string &password,
                   bool encrypted,bool headers,
                   const std::function<HRESULT(uint32_t,uint32_t,PROPVARIANT*)> &property);
