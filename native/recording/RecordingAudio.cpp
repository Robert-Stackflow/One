#include "audio-writer.h"
using namespace winrt;
using namespace one_audio;
using namespace one_audio_native;

static void capture(const std::wstring& path, bool pcm, const std::wstring& system, const std::wstring& microphone, DWORD owner, UINT bitrate, bool fixture = false) {
    Handle parent{OpenProcess(SYNCHRONIZE, FALSE, owner)}; if (!parent.value) throw_last_error();
    std::unique_ptr<Endpoint> sources[2];
    if (system != L"none") sources[0] = std::make_unique<Endpoint>(system, true, fixture);
    if (microphone != L"none") sources[1] = std::make_unique<Endpoint>(microphone, false, fixture);
    if (!sources[0] && !sources[1]) throw hresult_invalid_argument();
    const auto recovery = pcm ? path : (std::filesystem::path(path).parent_path() / L"recovery.wav").wstring();
    AudioWriter writer(path, pcm, bitrate, pcm ? L"" : recovery); Mixer mixer; Timeline timeline;
    auto controls = std::make_shared<Controls>();
    std::thread([controls] {
        char line[128]{};
        while (std::cin.getline(line, sizeof(line))) {
            std::lock_guard lock(controls->mutex);
            if (controls->queue.size() >= 16) { controls->queue.clear(); controls->queue.push_back("cancel 0"); }
            else controls->queue.emplace_back(line);
            SetEvent(controls->event.value);
        }
        { std::lock_guard lock(controls->mutex); controls->queue.push_back("cancel 0"); }
        SetEvent(controls->event.value);
    }).detach();
    SourceWriters stems(path, bool(sources[0]), bool(sources[1]));
    timeline.begin(clockTime(), 0); for (auto& source : sources) if (source) source->start();
    std::cout << "{\"kind\":\"ready\",\"rate\":48000,\"channels\":2}\n" << std::flush;
    bool paused = false, stopped = false, canceled = false; std::wstring warning;
    Level levels; auto reported = clockTime();
    const auto drain = [&] { for (int i = 0; i < 2; i++) if (sources[i]) sources[i]->drain(mixer, timeline, i); };
    const auto flush = [&](int64_t end) {
        end = std::min(end, int64_t(rate) * 3600);
        while (mixer.written < end) {
            std::array<std::vector<int16_t>, 2> blocks;
            auto pcm = mixer.take(int(std::min<int64_t>(960, end - mixer.written)), levels, &blocks);
            stems.append(blocks); writer.append(pcm);
        }
    };
    try {
        while (!stopped) {
            if (WaitForSingleObject(parent.value, 0) != WAIT_TIMEOUT) { canceled = true; break; }
            if (!paused) { drain(); flush(std::max(mixer.written, timeline.position(clockTime() - 1500000))); }
            std::deque<std::string> commands;
            { std::lock_guard lock(controls->mutex); commands.swap(controls->queue); }
            for (const auto& command : commands) {
                std::istringstream input(command); std::string verb; uint64_t id = 0; input >> verb >> id;
                if (verb == "cancel") { stopped = canceled = true; break; }
                if (verb == "stop") { stopped = true; break; }
                if (verb == "pause" && !paused) {
                    const auto end = timeline.position(clockTime()); drain();
                    for (auto& source : sources) if (source) source->pause();
                    flush(std::max(mixer.written, end)); mixer.reset(); levels = {}; paused = true;
                } else if (verb == "resume" && paused) {
                    timeline.begin(clockTime(), mixer.written); mixer.reset();
                    for (auto& source : sources) if (source) source->start(); paused = false;
                } else if (verb == "gain") {
                    double systemGain = 1, micGain = 1; input >> systemGain >> micGain;
                    if (!input || !std::isfinite(systemGain) || !std::isfinite(micGain) || systemGain < 0 || systemGain > 2 || micGain < 0 || micGain > 2)
                        throw hresult_invalid_argument();
                    mixer.gain = {systemGain, micGain};
                } else if (verb != "pause" && verb != "resume") throw hresult_invalid_argument();
                std::cout << "{\"kind\":\"ack\",\"id\":" << id << ",\"samples\":" << mixer.written << ",\"bytes\":" << fileBytes(path)
                    << ",\"paused\":" << (paused ? "true" : "false") << ",\"system\":" << std::min(1.0, levels.system)
                    << ",\"microphone\":" << std::min(1.0, levels.microphone) << ",\"mixed\":" << std::min(1.0, levels.mixed)
                    << ",\"clipped\":" << (levels.clipped ? "true" : "false") << "}\n" << std::flush;
            }
            const auto now = clockTime();
            if (now - reported >= 2500000) {
                std::cout << "{\"kind\":\"progress\",\"samples\":" << mixer.written << ",\"bytes\":" << fileBytes(path)
                    << ",\"paused\":" << (paused ? "true" : "false") << ",\"system\":" << std::min(1.0, levels.system)
                    << ",\"microphone\":" << std::min(1.0, levels.microphone) << ",\"mixed\":" << std::min(1.0, levels.mixed)
                    << ",\"clipped\":" << (levels.clipped ? "true" : "false") << "}\n" << std::flush;
                levels = {}; reported = now;
                ULARGE_INTEGER space{};
                const auto directory = std::filesystem::path(path).parent_path().wstring();
                check_bool(GetDiskFreeSpaceEx(directory.c_str(), &space, nullptr, nullptr));
                if (space.QuadPart < 64ull * 1024 * 1024 || std::max(fileBytes(path), fileBytes(recovery)) >= 1024ull * 1024 * 1024 - 32 * 1024 * 1024) {
                    warning = L"磁盘余量或录音容量不足，已停止并保留录音"; stopped = true;
                }
            }
            if (mixer.written >= int64_t(rate) * 3600) { warning = L"已达到 60 分钟上限"; stopped = true; }
            HANDLE events[3]{controls->event.value}; DWORD count = 1;
            if (!paused) for (auto& source : sources) if (source) events[count++] = source->event.value;
            WaitForMultipleObjects(count, events, FALSE, 10);
        }
        if (!paused && !canceled) { drain(); flush(std::max(mixer.written, timeline.position(clockTime()))); }
    } catch (const hresult_error& error) { warning = error.message(); }
      catch (const std::exception& error) { warning = to_hstring(error.what()); }
    for (auto& source : sources) if (source && source->client) source->client->Stop();
    if (canceled) return;
    stems.finish(writer.frames()); writer.finish();
    uint64_t discontinuities = 0; for (auto& source : sources) if (source) discontinuities += source->discontinuities;
    if (warning.empty() && discontinuities) warning = L"采集中检测到声音不连续，请检查预览";
    std::cout << "{\"kind\":\"done\",\"samples\":" << writer.frames() << ",\"bytes\":" << fileBytes(path)
        << ",\"warning\":" << jsonString(warning) << ",\"discontinuities\":" << discontinuities << ",\"late\":" << mixer.late << "}\n" << std::flush;
}
// Read the same WASAPI packets as recording, without creating or playing audio.
static void monitor(const std::wstring& channel, const std::wstring& device, DWORD owner, bool fixture) {
    Handle parent{OpenProcess(SYNCHRONIZE, FALSE, owner)}; if (!parent.value) throw_last_error();
    Endpoint endpoint(device, channel == L"system", fixture); Mixer mixer; Timeline timeline;
    auto controls = std::make_shared<Controls>();
    std::thread([controls] {
        char line[128]{}; std::cin.getline(line, sizeof(line));
        { std::lock_guard lock(controls->mutex); controls->queue.push_back("stop"); }
        SetEvent(controls->event.value);
    }).detach();
    timeline.begin(clockTime(), 0); endpoint.start();
    std::cout << "{\"kind\":\"ready\"}\n" << std::flush;
    Level level; auto reported = clockTime(), started = reported;
    while (WaitForSingleObject(parent.value, 0) == WAIT_TIMEOUT && clockTime() - started < 1200000000) {
        if (WaitForSingleObject(controls->event.value, 0) == WAIT_OBJECT_0) break;
        endpoint.drain(mixer, timeline, 0);
        const auto end = std::max(mixer.written, timeline.position(clockTime() - 1500000));
        while (mixer.written < end) mixer.take(int(std::min<int64_t>(960, end - mixer.written)), level);
        const auto now = clockTime();
        if (now - reported >= 500000) {
            std::cout << "{\"kind\":\"level\",\"value\":" << std::min(1.0, level.system) << "}\n" << std::flush;
            level = {}; reported = now;
        }
        HANDLE events[]{controls->event.value, endpoint.event.value, parent.value};
        if (WaitForMultipleObjects(3, events, FALSE, 10) == WAIT_OBJECT_0) break;
    }
}
static void selfTest() {
    Mixer mixer; Timeline timeline; timeline.begin(10000000, 0);
    if (timeline.position(10010000) != 48) throw std::runtime_error("QPC position mismatch");
    const float a[]{0.25f, -0.25f, 0.75f, -0.75f}, b[]{0.5f, -0.5f};
    mixer.put(0, 0, a, 2, false); mixer.put(1, 1, b, 1, false); Level level;
    const auto pcm = mixer.take(3, level);
    if (pcm[0] != 8192 || pcm[2] != 32767 || pcm[3] != -32767 || pcm[4] || !level.clipped) throw std::runtime_error("Mix alignment mismatch");
    mixer.reset(); timeline.begin(60000000, mixer.written);
    if (timeline.position(60000000) != 3) throw std::runtime_error("Pause changed sample duration");
    mixer.gain[0] = 0; mixer.put(0, 3, a, 2, false); level = {};
    std::array<std::vector<int16_t>, 2> stems;
    if (mixer.take(2, level, &stems)[0] != 0 || stems[0][0] != 8192 || stems[0][3] != -24575 || stems[1][0] != 0)
        throw std::runtime_error("Pre-fader source mismatch");
    mixer.gain[0] = 1;
    mixer.put(0, mixer.written - 1, a, 2, false);
    if (mixer.late != 1 || mixer.take(1, level)[0] != 24575) throw std::runtime_error("Late packet mismatch");
    mixer.put(1, mixer.written, nullptr, 1, true);
    if (mixer.take(1, level)[1] != 0) throw std::runtime_error("Silence mismatch");
    bool rejected = false;
    try { mixer.put(0, mixer.written + capacity, a, 1, false); } catch (const std::exception&) { rejected = true; }
    if (!rejected) throw std::runtime_error("Unbounded packet accepted");
    // Timestamp tags must prevent a ring slot from a previous second leaking
    // into a missing packet at the same modulo position.
    for (int i = 0; i < 50; i++) mixer.take(960, level);
    if (mixer.take(1, level)[0] != 0) throw std::runtime_error("Ring stale sample mismatch");
    // Recorded QPC jitter used to insert zeros or overwrite up to eleven PCM
    // frames per otherwise contiguous 480-frame WASAPI packet (audible clicks).
    Mixer continuous;PacketClock packets;
    for(int block=0;block<100;block++) {
        std::vector<float> samples(960);
        for(int i=0;i<480;i++) for(int c=0;c<2;c++) samples[i*2+c]=float(std::sin((block*480+i)*6.28318530718*440/rate)*0.25);
        const int jitter=block==0 ? 0 : (block%3==0 ? -11 : block%3==1 ? 4 : 2);
        const auto start=packets.place(block*480,480,block*480+jitter);
        continuous.put(0,start,samples.data(),480,false);Level l;
        const auto decoded=continuous.take(480,l);
        for(int i=0;i<480;i++) if(std::abs(decoded[i*2]-std::lround(samples[i*2]*32767))>1) throw std::runtime_error("Packet clock introduced audio clicks");
    }
    if(packets.place(49000,480,50000)!=50000) throw std::runtime_error("Device discontinuity lost");
    packets.reset();if(packets.place(0,480,96000)!=96000) throw std::runtime_error("Resume clock lost");
    std::cout << "{\"selfTest\":true,\"checks\":9}\n";
}
static void synthetic(const std::wstring& path, bool pcm) {
    AudioWriter writer(path, pcm, 128000);
    for (int n = 0; n < 50; n++) {
        std::vector<int16_t> block(960 * 2);
        for (int i = 0; i < 960; i++) {
            block[i * 2] = int16_t(std::sin((n * 960 + i) * 6.28318530718 * 440 / rate) * 12000);
            block[i * 2 + 1] = int16_t(std::sin((n * 960 + i) * 6.28318530718 * 880 / rate) * 12000);
        }
        writer.append(block);
    }
    writer.finish(); std::cout << "{\"synthetic\":true,\"samples\":48000}\n";
}
// File-only diagnostics use the same system codec as recording. No endpoint is
// opened and no audio is played; verification can run beside a capture session.
static void inspect(const std::wstring& path) {
    com_ptr<IMFSourceReader> reader;
    check_hresult(MFCreateSourceReaderFromURL(path.c_str(), nullptr, reader.put()));
    check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE));
    check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE));
    com_ptr<IMFMediaType> native;
    check_hresult(reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, native.put()));
    UINT sampleRate = 0, channelCount = 0;
    check_hresult(native->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate));
    check_hresult(native->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channelCount));
    if (sampleRate != rate || channelCount != channels) throw hresult_invalid_argument();
    check_hresult(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, type(false).get()));
    PROPVARIANT duration{};
    check_hresult(reader->GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE, MF_PD_DURATION, &duration));
    if (duration.vt != VT_UI8) { PropVariantClear(&duration); throw hresult_invalid_argument(); }
    const auto length = duration.uhVal.QuadPart; PropVariantClear(&duration);
    double real[2][2]{}, imaginary[2][2]{}; uint64_t samples = 0;
    for (;;) {
        DWORD flags = 0; LONGLONG timestamp = 0; com_ptr<IMFSample> sample;
        check_hresult(reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr, &flags, &timestamp, sample.put()));
        if (sample) {
            com_ptr<IMFMediaBuffer> buffer; check_hresult(sample->ConvertToContiguousBuffer(buffer.put()));
            BYTE* data = nullptr; DWORD bytes = 0; check_hresult(buffer->Lock(&data, nullptr, &bytes));
            if (bytes % 4 || samples + bytes / 4 > uint64_t(rate) * 3600) { buffer->Unlock(); throw hresult_invalid_argument(); }
            const auto pcm = reinterpret_cast<const int16_t*>(data);
            for (DWORD i = 0; i < bytes / 4; i++, samples++) for (int c = 0; c < 2; c++) for (int f = 0; f < 2; f++) {
                const double value = pcm[i * 2 + c] / 32768.0, angle = samples * 6.28318530718 * (f ? 880 : 440) / rate;
                real[c][f] += value * std::cos(angle); imaginary[c][f] += value * std::sin(angle);
            }
            check_hresult(buffer->Unlock());
        }
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) break;
    }
    if (!samples) throw hresult_invalid_argument();
    std::cout << "{\"rate\":" << sampleRate << ",\"channels\":" << channelCount << ",\"samples\":" << samples
        << ",\"duration\":" << double(length) / 10000000 << ",\"tones\":[";
    for (int c = 0; c < 2; c++) {
        if (c) std::cout << ','; std::cout << '[';
        for (int f = 0; f < 2; f++) { if (f) std::cout << ','; std::cout << std::hypot(real[c][f], imaginary[c][f]) * 2 / samples; }
        std::cout << ']';
    }
    std::cout << "]}\n";
}
int wmain(int argc, wchar_t** argv) {
    try {
        init_apartment(apartment_type::multi_threaded); check_hresult(MFStartup(MF_VERSION));
        if (argc == 2 && std::wstring(argv[1]) == L"devices") devices();
        else if (argc == 2 && std::wstring(argv[1]) == L"self-test") selfTest();
        else if (argc == 5 && (std::wstring(argv[1]) == L"monitor" || std::wstring(argv[1]) == L"monitor-test")) {
            const auto channel = std::wstring(argv[2]); const auto owner = std::stoul(argv[4]);
            if ((channel != L"system" && channel != L"microphone") || !owner) throw hresult_invalid_argument();
            monitor(channel, argv[3], owner, std::wstring(argv[1]) == L"monitor-test");
        }
        else if (argc == 3 && std::wstring(argv[1]) == L"inspect") inspect(argv[2]);
        else if (argc == 4 && std::wstring(argv[1]) == L"synthetic") {
            const auto format = std::wstring(argv[3]); if (format != L"wav" && format != L"m4a") throw hresult_invalid_argument();
            synthetic(argv[2], format == L"wav");
        }
        else if (argc == 8 && (std::wstring(argv[1]) == L"capture" || std::wstring(argv[1]) == L"capture-test")) {
            const auto bitrate = std::stoul(argv[7]), owner = std::stoul(argv[6]);
            if (!owner || (bitrate != 96000 && bitrate != 128000 && bitrate != 160000 && bitrate != 192000)) throw hresult_invalid_argument();
            const auto format = std::wstring(argv[3]); if (format != L"wav" && format != L"m4a") throw hresult_invalid_argument();
            // The fixture only replaces endpoint packets. It exercises the real
            // clock, command loop, mixer and encoders without opening hardware.
            capture(argv[2], format == L"wav", argv[4], argv[5], owner, bitrate, std::wstring(argv[1]) == L"capture-test");
        } else throw hresult_invalid_argument();
        check_hresult(MFShutdown()); uninit_apartment(); return 0;
    } catch (const hresult_error& error) { std::cerr << "Audio capture: " << to_string(error.message()) << std::endl; }
      catch (const std::exception& error) { std::cerr << "Audio capture: " << error.what() << std::endl; }
    return 1;
}
