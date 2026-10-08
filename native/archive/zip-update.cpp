#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <cwctype>
#include <map>
#include <memory>
#include "mz.h"
#include "mz_os.h"
#include "mz_strm.h"
#include "mz_zip.h"
#include "mz_zip_rw.h"
#include "zip-common.h"
#include "update-common.h"

namespace {
using namespace archive_update;
struct RenameInfo { std::string name; std::vector<uint8_t> extra; std::string comment; Reader *reader = nullptr; };
int32_t rename_metadata(void *, void *opaque, mz_zip_file *info) {
    auto &context = *static_cast<RenameInfo *>(opaque);
    info->filename = context.name.c_str();
    info->filename_size = static_cast<uint16_t>(context.name.size());
    context.comment = zip_name(*context.reader, info->comment, info->flag, info->extrafield, info->extrafield_size, 0x6375);
    info->comment = context.comment.c_str();
    info->comment_size = static_cast<uint16_t>(context.comment.size());
    info->flag |= MZ_ZIP_FLAG_UTF8;
    context.extra.clear();
    // Unicode path/comment fields contain a CRC of the old header bytes. The UTF-8
    // header is now authoritative; retain timestamp, AES and other extra fields.
    for (size_t offset = 0; offset + 4 <= info->extrafield_size;) {
        uint16_t tag = info->extrafield[offset] | (info->extrafield[offset+1] << 8);
        uint16_t size = info->extrafield[offset+2] | (info->extrafield[offset+3] << 8);
        if (size > info->extrafield_size - offset - 4) break;
        if (tag != 0x7075 && tag != 0x6375)
            context.extra.insert(context.extra.end(), info->extrafield + offset, info->extrafield + offset + 4 + size);
        offset += 4 + size;
    }
    info->extrafield = context.extra.empty() ? nullptr : context.extra.data();
    info->extrafield_size = static_cast<uint16_t>(context.extra.size());
    return MZ_OK;
}
struct Writer {
    void *value = mz_zip_writer_create();
    Writer() { if (!value) fail("Cannot initialize ZIP writer"); }
    ~Writer() { mz_zip_writer_delete(&value); }
};
}


void zip_update(const fs::path &source, const fs::path &temporary, const fs::path &backup,
                int encoding, const std::string &revision, const std::string &password) {
    check_staging(source,temporary,backup);
    // Deny writes/deletion throughout preflight, rewrite and verification.
    File original(source, GENERIC_READ, FILE_SHARE_READ);
    if (stamp(original.handle) != revision) fail("Archive changed; reopen it before saving changes");
    Plan plan;
    std::vector<OutputEntry> nodes;
    std::string comment;
    size_t old_count = 0;
    {
        Reader reader(source.wstring(), encoding);
        auto items = zip_entries(reader);
        old_count = items.size();
        zip_preflight(reader, items);
        void *zip = nullptr; mz_zip_reader_get_zip_handle(reader.value, &zip);
        uint32_t disk = 0;
        if (mz_zip_get_disk_number_with_cd(zip, &disk) != MZ_OK || disk != 0)
            fail("Split ZIP editing is not supported yet");
        const char *existing_comment = nullptr;
        mz_zip_reader_get_comment(reader.value, &existing_comment);
        comment = zip_comment(reader, existing_comment);
        bool encrypted = false;
        for (const auto &item : items) {
            encrypted = encrypted || item.encrypted;
            nodes.push_back({canonical(item.name, item.directory), item.directory, false, {}, item.encrypted});
        }
        // Verify the original too, including entries the user will remove. Never
        // silently discard corrupt/encrypted data without a successful full test.
        zip_test(reader, items, password, false);
        apply_plan(plan,nodes,source,encrypted,&comment);
        check_tree(nodes);
        uint64_t needed = 0;
        for (size_t i = 0; i < nodes.size(); ++i) if (!nodes[i].removed) {
            uint64_t bytes = i < old_count ? items[i].compressed : nodes[i].directory ? 0 : fs::file_size(nodes[i].source);
            if (bytes > UINT64_MAX - needed - 65536) fail("ZIP update size exceeds limits");
            needed += bytes + 65536;
        }
        auto capacity = fs::space(source.parent_path());
        if (capacity.available != UINTMAX_MAX &&
            (capacity.available < 256ull * 1024 * 1024 || needed > capacity.available - 256ull * 1024 * 1024))
            fail("Not enough free disk space to update the archive");
        Writer writer;
        mz_zip_writer_set_comment(writer.value, comment.c_str());
        mz_zip_writer_set_follow_links(writer.value, 0);
        mz_zip_writer_set_store_links(writer.value, 0);
        mz_zip_writer_set_compress_level(writer.value, 6);
        if (mz_zip_writer_open_file(writer.value, utf8(temporary.wstring()).c_str(), 0, 0) != MZ_OK)
            fail("Cannot create staging ZIP");
        RenameInfo context; context.reader = &reader;
        mz_zip_writer_set_entry_cb(writer.value, &context, rename_metadata);
        int err = mz_zip_reader_goto_first_entry(reader.value);
        size_t completed = 0, total = std::count_if(nodes.begin(), nodes.end(), [](const auto &node) { return !node.removed; });
        ULONGLONG last_progress = 0;
        auto progress = [&] {
            ++completed; auto now = GetTickCount64();
            if (completed == 1 || completed == total || now - last_progress >= 60) {
                emit("{\"type\":\"progress\",\"done\":" + std::to_string(completed) + ",\"total\":" + std::to_string(total) + "}");
                last_progress = now;
            }
        };
        for (size_t i = 0; i < old_count; ++i) {
            if (err != MZ_OK) fail("ZIP directory changed during update");
            if (!nodes[i].removed) {
                context.name = nodes[i].name;
                if (mz_zip_writer_copy_from_reader(writer.value, reader.value) != MZ_OK) fail("Cannot copy retained ZIP entry");
                progress();
            }
            err = mz_zip_reader_goto_next_entry(reader.value);
        }
        mz_zip_writer_set_entry_cb(writer.value, nullptr, nullptr);
        for (size_t i = old_count; i < nodes.size(); ++i) if (!nodes[i].removed) {
            const auto &node = nodes[i];
            mz_zip_writer_set_password(writer.value, node.encrypt ? password.c_str() : nullptr);
            mz_zip_writer_set_aes(writer.value, node.encrypt ? 1 : 0);
            int added;
            if (node.directory) {
                mz_zip_file info{}; info.filename = node.name.c_str(); info.flag = MZ_ZIP_FLAG_UTF8;
                info.version_madeby = MZ_VERSION_MADEBY; info.external_fa = FILE_ATTRIBUTE_DIRECTORY;
                added = mz_zip_writer_add_info(writer.value, nullptr, nullptr, &info);
            } else {
                check_source(node.source);
                File input(node.source, GENERIC_READ, FILE_SHARE_READ);
                added = mz_zip_writer_add_file(writer.value, utf8(node.source.wstring()).c_str(), node.name.c_str());
            }
            if (added != MZ_OK) fail("Cannot add ZIP entry: " + node.name);
            progress();
        }
        if (mz_zip_writer_close(writer.value) != MZ_OK) fail("Cannot finish staging ZIP");
    }
    size_t final_count = 0;
    {
        Reader verify(temporary.wstring(), 0);
        auto items = zip_entries(verify);
        final_count = items.size();
        zip_preflight(verify, items);
        zip_test(verify, items, password, false);
    }
    commit(original,source,temporary,backup,revision,final_count);
}
