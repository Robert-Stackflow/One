// Independent Windows Cabinet.dll reader for self-generated CAB test fixtures.
#include <windows.h>
#include <fdi.h>
#include <io.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <cstdlib>
#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>
#include <algorithm>
namespace fs = std::filesystem;
FNALLOC(allocate) { return std::malloc(cb); }
FNFREE(release) { std::free(pv); }
FNOPEN(open_file) { return _open(pszFile, oflag | _O_BINARY, pmode); }
FNREAD(read_file) { return _read((int)hf, pv, cb); }
FNWRITE(write_file) { return _write((int)hf, pv, cb); }
FNCLOSE(close_file) { return _close((int)hf); }
FNSEEK(seek_file) { return _lseek((int)hf, dist, seektype); }
FNFDINOTIFY(notify) {
    if (fdint == fdintCOPY_FILE) {
        const std::string name = pfdin->psz1;
        if (name.empty() || name.find_first_of("/\\:") != std::string::npos || name == "." || name == "..") return -1;
        const auto destination = *static_cast<fs::path*>(pfdin->pv) / name;
        if (fs::exists(destination)) return 0;
        return _wopen(destination.c_str(), _O_CREAT | _O_EXCL | _O_WRONLY | _O_BINARY, _S_IREAD | _S_IWRITE);
    }
    if (fdint == fdintCLOSE_FILE_INFO) return _close((int)pfdin->hf) == 0;
    if (fdint == fdintNEXT_CABINET && pfdin->fdie != FDIERROR_NONE) return -1;
    return 0;
}
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    const fs::path source = fs::absolute(argv[1]), output = fs::absolute(argv[2]);
    if (!fs::is_directory(output) || !fs::is_empty(output)) return 2;
    ERF error{};
    HFDI reader = FDICreate(allocate, release, open_file, read_file, write_file, close_file, seek_file, cpu80386, &error);
    if (!reader) return 3;
    std::string directory = source.parent_path().string() + "\\";
    fs::path destination = output;
    // FDI follows continuation cabinets for a split file, but files beginning in
    // a later cabinet still require a separate FDICopy call for that cabinet.
    std::vector<std::string> cabinets;
    for (const auto &item : fs::directory_iterator(source.parent_path()))
        if (item.path().extension() == ".cab") cabinets.push_back(item.path().filename().string());
    std::sort(cabinets.begin(), cabinets.end());
    bool ok = !cabinets.empty();
    for (auto &filename : cabinets)
        if (!FDICopy(reader, filename.data(), directory.data(), 0, notify, nullptr, &destination)) { ok = false; break; }
    FDIDestroy(reader);
    if (!ok) std::fprintf(stderr, "Windows Cabinet.dll error: %d / %d\n", error.erfOper, error.erfType);
    return ok ? 0 : 1;
}
