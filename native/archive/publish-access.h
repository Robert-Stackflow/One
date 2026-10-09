#pragma once
#include <windows.h>

// Publishing, rollback and backup cleanup inspect metadata, then rename or
// delete by handle. They never read payload data. DELETE still participates
// in sharing checks when the handle only permits FILE_SHARE_READ.
inline constexpr DWORD archive_publish_file_access=FILE_READ_ATTRIBUTES|DELETE;
