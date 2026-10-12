#pragma once
#include "audio-source.h"
namespace one_audio_native {
using namespace winrt;
using namespace one_audio;
class AudioWriter {
    Handle wav;
    com_ptr<IMFSinkWriter> sink;
    std::unique_ptr<AudioWriter> journal;
    DWORD stream = 0;
    bool done = false;
    uint64_t samples = 0;
    uint64_t checkpoint = 0;
    void write(const void* data, DWORD length) {
        DWORD written = 0; check_bool(WriteFile(wav.value, data, length, &written, nullptr));
        if (written != length) throw hresult_error(E_FAIL, L"录音写入不完整");
    }
public:
    AudioWriter(const std::wstring& path, bool pcm, UINT bitrate, const std::wstring& journalPath = L"") {
        if (pcm) {
            wav.value = CreateFile(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (wav.value == INVALID_HANDLE_VALUE) throw_last_error();
            header();
        } else {
            if (!journalPath.empty()) journal = std::make_unique<AudioWriter>(journalPath, true, bitrate);
            if (GetFileAttributes(path.c_str()) != INVALID_FILE_ATTRIBUTES) throw hresult_error(E_FAIL, L"录音文件已存在");
            com_ptr<IMFAttributes> attributes; check_hresult(MFCreateAttributes(attributes.put(), 2));
            check_hresult(attributes->SetGUID(MF_TRANSCODE_CONTAINERTYPE, MFTranscodeContainerType_MPEG4));
            check_hresult(MFCreateSinkWriterFromURL(path.c_str(), nullptr, attributes.get(), sink.put()));
            check_hresult(sink->AddStream(type(true, bitrate).get(), &stream));
            check_hresult(sink->SetInputMediaType(stream, type(false).get(), nullptr));
            check_hresult(sink->BeginWriting());
        }
    }
    void header() {
        const uint32_t size = uint32_t(samples * 4);
        uint8_t h[44]{}; memcpy(h, "RIFF", 4); memcpy(h + 8, "WAVEfmt ", 8); memcpy(h + 36, "data", 4);
        const auto u32 = [&](int index, uint32_t v) { memcpy(h + index, &v, 4); };
        const auto u16 = [&](int index, uint16_t v) { memcpy(h + index, &v, 2); };
        u32(4, size + 36); u32(16, 16); u16(20, 1); u16(22, 2); u32(24, rate); u32(28, rate * 4);
        u16(32, 4); u16(34, 16); u32(40, size);
        LARGE_INTEGER zero{}; check_bool(SetFilePointerEx(wav.value, zero, nullptr, FILE_BEGIN)); write(h, 44);
        check_bool(SetFilePointerEx(wav.value, zero, nullptr, FILE_END));
    }
    void append(const std::vector<int16_t>& pcm) {
        if (pcm.empty()) return;
        const auto frames = pcm.size() / channels;
        if (samples + frames > uint64_t(rate) * 3600) throw hresult_error(E_FAIL, L"已达到录音时长上限");
        // PCM is recoverable even when an AAC encoder or MP4 finalization fails.
        if (journal) journal->append(pcm);
        if (sink) {
            com_ptr<IMFMediaBuffer> buffer; check_hresult(MFCreateMemoryBuffer(DWORD(pcm.size() * 2), buffer.put()));
            BYTE* destination = nullptr; check_hresult(buffer->Lock(&destination, nullptr, nullptr));
            memcpy(destination, pcm.data(), pcm.size() * 2); check_hresult(buffer->Unlock());
            check_hresult(buffer->SetCurrentLength(DWORD(pcm.size() * 2)));
            com_ptr<IMFSample> sample; check_hresult(MFCreateSample(sample.put())); check_hresult(sample->AddBuffer(buffer.get()));
            const auto start = samples * 10000000 / rate, end = (samples + frames) * 10000000 / rate;
            check_hresult(sample->SetSampleTime(start)); check_hresult(sample->SetSampleDuration(end - start));
            check_hresult(sink->WriteSample(stream, sample.get()));
        } else { write(pcm.data(), DWORD(pcm.size() * 2)); }
        samples += frames;
        if (wav.value && samples - checkpoint >= rate) {
            header(); check_bool(FlushFileBuffers(wav.value)); checkpoint = samples;
        }
    }
    void finish() {
        if (done) return;
        if (journal) journal->finish();
        if (sink) { check_hresult(sink->Finalize()); sink = nullptr; }
        else {
            // A failed WriteFile can leave a partial block. Retain only fully
            // accepted samples and truncate the uncommitted tail before repair.
            LARGE_INTEGER end{}; end.QuadPart = 44 + samples * channels * 2;
            check_bool(SetFilePointerEx(wav.value, end, nullptr, FILE_BEGIN));
            check_bool(SetEndOfFile(wav.value)); header(); check_bool(FlushFileBuffers(wav.value));
        }
        done = true;
    }
    void finishAt(uint64_t limit) {
        if (!wav.value || samples < limit) throw hresult_error(E_FAIL, L"独立声源不完整");
        samples = limit; finish();
    }
    uint64_t frames() const { return samples; }
};
class SourceWriters {
    std::array<std::unique_ptr<AudioWriter>, 2> writers;
public:
    SourceWriters(const std::wstring& path, bool system, bool microphone) {
        if (system) writers[0] = std::make_unique<AudioWriter>(path + L".system.wav", true, 128000);
        if (microphone) writers[1] = std::make_unique<AudioWriter>(path + L".microphone.wav", true, 128000);
    }
    void append(const std::array<std::vector<int16_t>, 2>& pcm) {
        for (int i = 0; i < 2; i++) if (writers[i]) writers[i]->append(pcm[i]);
    }
    void finish(uint64_t samples) {
        for (auto& writer : writers) if (writer) writer->finishAt(samples);
    }
};
}
