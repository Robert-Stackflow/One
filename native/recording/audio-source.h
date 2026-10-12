#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mftransform.h>
#include <wmcodecdsp.h>
#include <winrt/base.h>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <mutex>
#include <deque>
#include <thread>
#include <memory>
#include <filesystem>
#include "audio-core.h"
namespace one_audio_native {
using namespace winrt;
using namespace one_audio;
struct Handle {
    HANDLE value = nullptr;
    explicit Handle(HANDLE v = nullptr) : value(v) {}
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};
static int64_t clockTime() {
    LARGE_INTEGER counter{}, frequency{}; QueryPerformanceCounter(&counter); QueryPerformanceFrequency(&frequency);
    return int64_t(counter.QuadPart / frequency.QuadPart) * 10000000 +
        (counter.QuadPart % frequency.QuadPart) * 10000000 / frequency.QuadPart;
}
static std::string jsonString(std::wstring_view value) {
    std::ostringstream out; out << '"';
    for (const auto c : to_string(value)) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (uint8_t(c) < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(uint8_t(c)) << std::dec;
        else out << c;
    }
    return out.str() + '"';
}
static com_ptr<IMFMediaType> type(bool aac, UINT bitrate = 128000) {
    com_ptr<IMFMediaType> result; check_hresult(MFCreateMediaType(result.put()));
    check_hresult(result->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio));
    check_hresult(result->SetGUID(MF_MT_SUBTYPE, aac ? MFAudioFormat_AAC : MFAudioFormat_PCM));
    check_hresult(result->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, channels));
    check_hresult(result->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, rate));
    check_hresult(result->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16));
    check_hresult(result->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, aac ? bitrate / 8 : rate * channels * 2));
    check_hresult(result->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, aac ? 1 : channels * 2));
    if (aac) check_hresult(result->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0));
    return result;
}
static bool aacAvailable(UINT bitrate) {
    try {
        const auto encoder = create_instance<IMFTransform>(CLSID_AACMFTEncoder);
        check_hresult(encoder->SetOutputType(0, type(true, bitrate).get(), 0));
        check_hresult(encoder->SetInputType(0, type(false).get(), 0));
        return true;
    } catch (...) { return false; }
}
static com_ptr<IMMDeviceEnumerator> enumerator() { return create_instance<IMMDeviceEnumerator>(__uuidof(MMDeviceEnumerator)); }
static void devices() {
    auto all = enumerator();
    std::cout << "{\"devices\":["; bool comma = false;
    for (const auto flow : {eRender, eCapture}) {
        com_ptr<IMMDeviceCollection> collection; check_hresult(all->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, collection.put()));
        UINT count = 0; check_hresult(collection->GetCount(&count));
        for (UINT i = 0; i < std::min(count, 128u); i++) {
            com_ptr<IMMDevice> device; check_hresult(collection->Item(i, device.put()));
            LPWSTR id = nullptr; check_hresult(device->GetId(&id));
            std::wstring identifier(id); CoTaskMemFree(id);
            com_ptr<IPropertyStore> properties; check_hresult(device->OpenPropertyStore(STGM_READ, properties.put()));
            PROPVARIANT name{}; check_hresult(properties->GetValue(PKEY_Device_FriendlyName, &name));
            const auto title = name.vt == VT_LPWSTR ? std::wstring(name.pwszVal) : identifier;
            PropVariantClear(&name);
            if (comma) std::cout << ','; comma = true;
            std::cout << "{\"id\":" << jsonString(identifier) << ",\"name\":" << jsonString(title)
                << ",\"kind\":\"" << (flow == eRender ? "system" : "microphone") << "\"}";
        }
    }
    std::cout << "],\"bitrates\":["; comma = false;
    for (const auto bitrate : {96000u, 128000u, 160000u, 192000u}) if (aacAvailable(bitrate)) {
        if (comma) std::cout << ','; comma = true; std::cout << bitrate;
    }
    std::cout << "],\"rate\":48000,\"channels\":2}\n" << std::flush;
}
struct Endpoint {
    com_ptr<IMMDevice> device;
    com_ptr<IAudioClient> client;
    com_ptr<IAudioCaptureClient> capture;
    Handle event{CreateEvent(nullptr, FALSE, FALSE, nullptr)};
    uint64_t discontinuities = 0, packets = 0;
    bool synthetic = false, active = false, loopbackSource = false;
    int64_t origin = 0, produced = 0;
    PacketClock packetClock;
    explicit Endpoint(const std::wstring& id, bool loopback, bool fixture = false) : synthetic(fixture), loopbackSource(loopback) {
        if (synthetic) return;
        const auto all = enumerator();
        if (id == L"default") check_hresult(all->GetDefaultAudioEndpoint(loopback ? eRender : eCapture, eConsole, device.put()));
        else check_hresult(all->GetDevice(id.c_str(), device.put()));
        EDataFlow flow{}; check_hresult(device.as<IMMEndpoint>()->GetDataFlow(&flow));
        if (flow != (loopback ? eRender : eCapture)) throw hresult_invalid_argument();
        DWORD state = 0; check_hresult(device->GetState(&state)); if (state != DEVICE_STATE_ACTIVE) throw hresult_error(E_FAIL, L"声音设备不可用");
        check_hresult(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, client.put_void()));
        WAVEFORMATEX format{}; format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT; format.nChannels = channels;
        format.nSamplesPerSec = rate; format.wBitsPerSample = 32; format.nBlockAlign = channels * 4;
        format.nAvgBytesPerSec = rate * format.nBlockAlign;
        check_hresult(client->Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY |
            (loopback ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0), 1000000, 0, &format, nullptr));
        check_hresult(client->SetEventHandle(event.value));
        check_hresult(client->GetService(__uuidof(IAudioCaptureClient), capture.put_void()));
    }
    ~Endpoint() { if (client) client->Stop(); }
    void start() {
        packetClock.reset();
        if (synthetic) { origin = clockTime(); produced = 0; active = true; return; }
        check_hresult(client->Start());
    }
    void pause() {
        if (synthetic) { active = false; return; }
        check_hresult(client->Stop()); check_hresult(client->Reset());
    }
    void drain(Mixer& mixer, const Timeline& timeline, int source) {
        if (synthetic) {
            if (!active) return;
            const auto end = (clockTime() - origin) * rate / 10000000;
            while (produced < end) {
                const int frames = int(std::min<int64_t>(960, end - produced));
                std::vector<float> values(size_t(frames) * channels, 0);
                for (int i = 0; i < frames; i++) values[size_t(i) * channels + (loopbackSource ? 0 : 1)] =
                    float(std::sin((produced + i) * 6.28318530718 * (loopbackSource ? 440 : 880) / rate) * 0.25);
                mixer.put(source, timeline.position(origin + produced * 10000000 / rate), values.data(), frames, false);
                produced += frames; packets++;
            }
            return;
        }
        UINT size = 0; check_hresult(capture->GetNextPacketSize(&size));
        while (size) {
            BYTE* data = nullptr; UINT frames = 0; DWORD flags = 0; UINT64 position = 0, timestamp = 0;
            check_hresult(capture->GetBuffer(&data, &frames, &flags, &position, &timestamp));
            try {
                if (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) throw hresult_error(E_FAIL, L"声音设备无法提供可靠的采集时钟");
                if ((flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) && packets) discontinuities++;
                const auto start=packetClock.place(position, frames, timeline.position(int64_t(timestamp)));
                mixer.put(source, start, reinterpret_cast<float*>(data), frames, flags & AUDCLNT_BUFFERFLAGS_SILENT);
                packets++;
            } catch (...) { capture->ReleaseBuffer(frames); throw; }
            check_hresult(capture->ReleaseBuffer(frames));
            check_hresult(capture->GetNextPacketSize(&size));
        }
    }
};
struct Controls {
    std::mutex mutex;
    std::deque<std::string> queue;
    Handle event{CreateEvent(nullptr, FALSE, FALSE, nullptr)};
};
static uint64_t fileBytes(const std::wstring& path) {
    WIN32_FILE_ATTRIBUTE_DATA info{};
    if (!GetFileAttributesEx(path.c_str(), GetFileExInfoStandard, &info)) return 0;
    return (uint64_t(info.nFileSizeHigh) << 32) | info.nFileSizeLow;
}
}
