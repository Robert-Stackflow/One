#pragma once
#include "common.h"
// Scan ordinary staging files before exposing their contents or publishing.
// The local AMSI provider consumes IAmsiStream; One never maps whole files.
void archive_scan(const fs::path &stage);
