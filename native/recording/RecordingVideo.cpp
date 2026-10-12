#include "video-source.h"
#include "audio-writer.h"
#include "recording-input.h"
#include "recording-cursor.h"
#include "camera-source.h"
#include <atomic>
#include <io.h>
#include <fcntl.h>
#include "annotation-frame.h"
#include <codecapi.h>
#include <mferror.h>
using namespace one_video;
using namespace one_audio;
static void checked(HRESULT result, const wchar_t* stage) {
    if (FAILED(result)) throw hresult_error(result, std::wstring(stage) + L": " + hresult_error(result).message().c_str());
}
static uint64_t integer(const wchar_t* value, bool zero = false) {
    wchar_t* end = nullptr; const auto n = wcstoull(value, &end, 10);
    if (!*value || *end || *value == L'-' || (!zero && !n)) throw hresult_invalid_argument(); return n;
}
static com_ptr<IMFMediaType> videoType(bool encoded, UINT width, UINT height, UINT fps, UINT bitrate) {
    com_ptr<IMFMediaType> result; check_hresult(MFCreateMediaType(result.put()));
    check_hresult(result->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
    check_hresult(result->SetGUID(MF_MT_SUBTYPE, encoded ? MFVideoFormat_H264 : MFVideoFormat_NV12));
    check_hresult(MFSetAttributeSize(result.get(), MF_MT_FRAME_SIZE, width, height));
    check_hresult(MFSetAttributeRatio(result.get(), MF_MT_FRAME_RATE, fps, 1));
    check_hresult(MFSetAttributeRatio(result.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
    check_hresult(result->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
    check_hresult(result->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235));
    check_hresult(result->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709));
    if (encoded) {
        check_hresult(result->SetUINT32(MF_MT_AVG_BITRATE, bitrate));
        check_hresult(result->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main));
    }
    return result;
}
class VideoWriter {
    std::wstring path;
    com_ptr<IMFByteStream> bytes;
    com_ptr<IMFMediaSink> media;
    com_ptr<IMFSinkWriter> sink;
    DWORD video = 0, audio = 0;
    bool sound, finished = false;
    void append(DWORD stream, IMFMediaBuffer* buffer, int64_t time, int64_t duration) {
        com_ptr<IMFSample> sample; check_hresult(MFCreateSample(sample.put()));
        check_hresult(sample->AddBuffer(buffer)); check_hresult(sample->SetSampleTime(time));
        check_hresult(sample->SetSampleDuration(duration)); checked(sink->WriteSample(stream, sample.get()), stream == video ? L"Write video sample" : L"Write audio sample");
    }
public:
    uint64_t frames = 0, audioFrames = 0;
    UINT fps;
    std::wstring encoder = L"H.264";
    VideoWriter(const std::wstring& path, UINT width, UINT height, UINT fps, UINT bitrate, bool sound, UINT audioBitrate, bool hardware)
        : path(path), sound(sound), fps(fps) {
        check_hresult(MFCreateFile(MF_ACCESSMODE_WRITE, MF_OPENMODE_FAIL_IF_EXIST, MF_FILEFLAGS_NONE, path.c_str(), bytes.put()));
        const auto vt = videoType(true, width, height, fps, bitrate), at = sound ? type(true, audioBitrate) : nullptr;
        check_hresult(MFCreateFMPEG4MediaSink(bytes.get(), vt.get(), sound ? at.get() : nullptr, media.put()));
        com_ptr<IMFAttributes> attributes; check_hresult(MFCreateAttributes(attributes.put(), 3));
        check_hresult(attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, hardware));
        check_hresult(attributes->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE));
        check_hresult(attributes->SetUINT32(MF_LOW_LATENCY, TRUE));
        check_hresult(MFCreateSinkWriterFromMediaSink(media.get(), attributes.get(), sink.put()));
        // The fragmented sink already has streams; writer stream IDs are its indexes.
        check_hresult(sink->SetInputMediaType(video, videoType(false, width, height, fps, bitrate).get(), nullptr));
        if (sound) { audio = 1; check_hresult(sink->SetInputMediaType(audio, type(false).get(), nullptr)); }
        if (const auto ex = sink.try_as<IMFSinkWriterEx>()) {
            for (DWORD i = 0; i < 8; i++) {
                GUID category{}; com_ptr<IMFTransform> transform;
                if (FAILED(ex->GetTransformForStream(video, i, &category, transform.put()))) break;
                if (category == MFT_CATEGORY_VIDEO_ENCODER) {
                    com_ptr<IMFAttributes> values;
                    if (SUCCEEDED(transform->GetAttributes(values.put()))) {
                        wchar_t name[512]{};
                        if (SUCCEEDED(values->GetString(MFT_FRIENDLY_NAME_Attribute, name, 512, nullptr))) encoder = name;
                    }
                    if (const auto codec = transform.try_as<ICodecAPI>()) {
                        VARIANT v{}; v.vt = VT_UI4; v.ulVal = fps * 2; codec->SetValue(&CODECAPI_AVEncMPVGOPSize, &v);
                        v.ulVal = 0; codec->SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &v);
                    }
                }
            }
        }
        check_hresult(sink->BeginWriting());
    }
    ~VideoWriter() { try { if (media) media->Shutdown(); if (bytes) bytes->Close(); } catch (...) {} }
    void picture(IMFMediaBuffer* buffer) {
        const auto begin = frames * 10000000 / fps, end = (frames + 1) * 10000000 / fps;
        append(video, buffer, begin, end - begin); frames++;
    }
    void pcm(const std::vector<int16_t>& values) {
        if (!sound || values.empty()) return;
        com_ptr<IMFMediaBuffer> buffer; const auto length = DWORD(values.size() * 2);
        check_hresult(MFCreateMemoryBuffer(length, buffer.put())); BYTE* bytes = nullptr;
        check_hresult(buffer->Lock(&bytes, nullptr, nullptr)); memcpy(bytes, values.data(), length); check_hresult(buffer->Unlock());
        check_hresult(buffer->SetCurrentLength(length)); const auto end = audioFrames + values.size() / channels;
        append(audio, buffer.get(), audioFrames * 10000000 / rate, (end * 10000000 / rate) - (audioFrames * 10000000 / rate));
        audioFrames = end;
    }
    void finish() {
        if (finished) return;
        // Finalize completes the sink's writes and can close its byte stream.
        // Do not call Flush on that invalidated stream. Release the sink first,
        // then request durable storage through a new file handle.
        checked(sink->Finalize(), L"Finalize MP4 writer"); sink = nullptr;
        const auto result = media->Shutdown();
        if (result != MF_E_SHUTDOWN) checked(result, L"Shutdown MP4 sink");
        media = nullptr; bytes = nullptr;
        Handle file{CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)};
        if (file.value == INVALID_HANDLE_VALUE) throw_last_error();
        check_bool(FlushFileBuffers(file.value)); finished = true;
    }
};
static void capture(const std::wstring& path, const std::wstring& kind, uint64_t target, DWORD pid, DWORD owner,
    RECT crop, UINT maximum, UINT fps, UINT bitrate, const std::wstring& system, const std::wstring& microphone,
    UINT audioBitrate, bool cursor, bool hardware, bool fixture, unsigned inputFlags, const std::wstring& cameraId) {
    Handle parent{OpenProcess(SYNCHRONIZE, FALSE, owner)}; if (!parent.value) throw_last_error();
    GPU gpu;
    const bool cameraPrimary = kind == L"camera";
    std::unique_ptr<VideoSource> source;
    std::unique_ptr<CameraSource> primaryCamera;
    if(cameraPrimary) primaryCamera=std::make_unique<CameraSource>(gpu,cameraId,fixture);
    else source=std::make_unique<VideoSource>(gpu,kind,target,pid,false,fixture);
    const auto sourceWidth=source ? source->width() : LONG(primaryCamera->width());
    const auto sourceHeight=source ? source->height() : LONG(primaryCamera->height());
    const auto bounds=source ? source->bounds() : RECT{0,0,sourceWidth,sourceHeight};
    const bool movable = kind == L"screen" && crop.right != 0 && crop.bottom != 0;
    if (crop.right == 0 && crop.bottom == 0) crop = {0, 0, sourceWidth, sourceHeight};
    Converter converter(gpu, sourceWidth, sourceHeight, crop, maximum, fps);
    std::unique_ptr<CameraSource> camera;
    std::unique_ptr<Converter> cameraConverter;
    std::unique_ptr<VideoWriter> cameraWriter;
    const auto cameraPath=path+L".camera.mp4";
    if(cameraId!=L"none" && !cameraPrimary) {
        camera=std::make_unique<CameraSource>(gpu,cameraId,fixture);
        cameraConverter=std::make_unique<Converter>(gpu,camera->width(),camera->height(),RECT{0,0,LONG(camera->width()),LONG(camera->height())},1280,fps);
        cameraWriter=std::make_unique<VideoWriter>(cameraPath,cameraConverter->width,cameraConverter->height,fps,3000000,false,audioBitrate,hardware);
    }
    std::unique_ptr<Endpoint> endpoints[2];
    if (system != L"none") endpoints[0] = std::make_unique<Endpoint>(system, true, fixture);
    if (microphone != L"none") endpoints[1] = std::make_unique<Endpoint>(microphone, false, fixture);
    VideoWriter writer(path, converter.width, converter.height, fps, bitrate, bool(endpoints[0] || endpoints[1]), audioBitrate, hardware);
    CursorTracker pointer(cursor, fixture, converter.width, converter.height, path);
    auto controls = std::make_shared<Controls>();
    std::thread([controls] {
        char line[128]{};
        while (std::cin.getline(line, sizeof(line))) {
            std::lock_guard lock(controls->mutex);
            if (controls->queue.size() >= 16) { controls->queue.clear(); controls->queue.push_back("cancel 0"); }
            else controls->queue.emplace_back(line); SetEvent(controls->event.value);
        }
        { std::lock_guard lock(controls->mutex); controls->queue.push_back("cancel 0"); } SetEvent(controls->event.value);
    }).detach();
    Timeline timeline; Mixer mixer; Level levels;
    InputTracker inputs(inputFlags, owner, kind == L"window" ? reinterpret_cast<HWND>(target) : nullptr,
        kind == L"screen" ? reinterpret_cast<HMONITOR>(target) : nullptr, bounds, crop, converter.width, converter.height, fixture, path);
    timeline.begin(clockTime(), 0); for (auto& endpoint : endpoints) if (endpoint) endpoint->start();
    std::cout << "{\"kind\":\"ready\",\"rate\":48000,\"channels\":2,\"width\":" << converter.width
        << ",\"height\":" << converter.height << ",\"fps\":" << fps << ",\"encoder\":" << jsonString(writer.encoder)
        << ",\"sourceWidth\":" << sourceWidth << ",\"sourceHeight\":" << sourceHeight;
    if(camera) std::cout << ",\"camera\":{\"width\":" << cameraConverter->width << ",\"height\":" << cameraConverter->height << ",\"fps\":" << fps << ",\"encoder\":" << jsonString(cameraWriter->encoder) << "}";
    std::cout << "}\n" << std::flush;
    inputs.enable(true);
    bool paused = false, stopped = false, canceled = false; std::wstring warning;
    int64_t reportAt = clockTime();
    const auto drain = [&] { for (int i = 0; i < 2; i++) if (endpoints[i]) endpoints[i]->drain(mixer, timeline, i); };
    one_audio_native::SourceWriters stems(path, bool(endpoints[0]), bool(endpoints[1]));
    const auto audioUntil = [&](int64_t end) {
        while (mixer.written < end) {
            std::array<std::vector<int16_t>, 2> blocks;
            auto pcm = mixer.take(int(std::min<int64_t>(960, end - mixer.written)), levels, &blocks);
            stems.append(blocks); writer.pcm(pcm);
        }
    };
    com_ptr<IMFMediaBuffer> annotationBuffer;
    const wchar_t* stage = L"采集画面";
    const auto advance = [&](int64_t position) {
        const auto count = std::max<int64_t>(1, (position * fps + rate - 1) / rate);
        if (count > int64_t(writer.frames) + fps) throw hresult_error(E_FAIL, L"编码持续落后，已结束并保留录制，请降低帧率或质量");
        while (int64_t(writer.frames) < count) {
            const auto consume = [&](auto texture) { return converter.convert(texture); };
            stage = L"采集与转换画面";
            auto buffer = source ? source->read(writer.frames * 10000000 / fps, consume) : primaryCamera->read(writer.frames * 10000000 / fps, consume);
            annotationBuffer = buffer;
            stage = L"读取鼠标光标";
            pointer.sample(writer.frames * rate / fps, writer.frames, source ? source->bounds() : bounds, crop, kind==L"window"?reinterpret_cast<HWND>(target):nullptr,owner);
            stage = L"编码视频";
            writer.picture(buffer.get());
            if(camera) {
                stage = L"采集摄像头画中画";
                auto frame=camera->read(cameraWriter->frames*10000000/fps,[&](auto texture) {return cameraConverter->convert(texture);});
                cameraWriter->picture(frame.get());
            }
        }
    };
    const auto progress = [&](const char* kind, uint64_t id = 0, bool moved = false) {
        std::cout << "{\"kind\":\"" << kind << "\",\"id\":" << id << ",\"samples\":" << writer.frames * rate / fps
            << ",\"bytes\":" << fileBytes(path) << ",\"paused\":" << (paused ? "true" : "false")
            << ",\"system\":" << std::min(1.0, levels.system) << ",\"microphone\":" << std::min(1.0, levels.microphone)
            << ",\"mixed\":" << std::min(1.0, levels.mixed) << ",\"clipped\":" << (levels.clipped ? "true" : "false")
            << ",\"inputFlags\":" << inputFlags;
        if (moved) std::cout << ",\"crop\":{\"x\":" << crop.left << ",\"y\":" << crop.top
            << ",\"width\":" << crop.right - crop.left << ",\"height\":" << crop.bottom - crop.top << "}";
        std::cout << "}\n" << std::flush;
    };
    try {
        while (!stopped) {
            if (WaitForSingleObject(parent.value, 0) != WAIT_TIMEOUT) { canceled = true; break; }
            if (!paused) {
                stage = L"采集系统声音或麦克风";
                drain(); advance(std::min<int64_t>(timeline.position(clockTime()), int64_t(rate) * 3600));
                stage = L"混合声音";
                audioUntil(std::max(mixer.written, std::min<int64_t>(writer.frames * rate / fps, timeline.position(clockTime() - 1500000))));
                stage = L"读取键鼠回显";
                if (inputFlags & 12) inputs.location(source->bounds());
                inputs.drain(timeline, writer.frames * rate / fps);
            }
            if(camera) {
                stage = L"预览摄像头画中画";
                camera->validate();
                if(paused) camera->fixtureFrame(clockTime());
                camera->preview(path+L".camera.jpg");
            }
            if(primaryCamera) {
                primaryCamera->validate();
                if(paused) primaryCamera->fixtureFrame(clockTime());
                primaryCamera->preview(path+L".camera.jpg");
            }
            std::deque<std::string> commands; { std::lock_guard lock(controls->mutex); commands.swap(controls->queue); }
            for (const auto& command : commands) {
                std::istringstream input(command); std::string verb; uint64_t id = 0; input >> verb;
                if (verb == "fixture-input") { inputs.fixtureEvent(input); continue; }
                if (verb == "fixture-cursor") {
                    int x=0,y=0,shape=0,buttons=0; input>>x>>y>>shape>>buttons;
                    if(!input) throw hresult_invalid_argument(); pointer.configureFixture(x,y,shape,buttons); continue;
                }
                if(verb=="fixture-camera-fail") {
                    if(!fixture || (!camera && !primaryCamera)) throw hresult_invalid_argument();
                    throw hresult_error(HRESULT_FROM_WIN32(ERROR_DEVICE_NOT_CONNECTED),L"摄像头已断开，录制已停止并保留");
                }
                input >> id;
                if (verb == "fixture-pattern") { if (!fixture || !source) throw hresult_invalid_argument(); source->fixturePattern(); continue; }
                if (verb == "cancel") { stopped = canceled = true; break; }
                if (verb == "stop") { stopped = true; break; }
                if (verb == "pause" && !paused) {
                    inputs.enable(false); inputs.drain(timeline, writer.frames * rate / fps);
                    drain(); for (auto& endpoint : endpoints) if (endpoint) endpoint->pause();
                    audioUntil(writer.frames * rate / fps); mixer.reset(); levels = {}; paused = true;
                } else if (verb == "resume" && paused) {
                    pointer.split();
                    timeline.begin(clockTime(), writer.frames * rate / fps); mixer.reset();
                    for (auto& endpoint : endpoints) if (endpoint) endpoint->start(); paused = false;
                    inputs.enable(true);
                } else if (verb == "crop") {
                    int x = -1, y = -1; input >> x >> y; input >> std::ws;
                    if (!movable || !input.eof() || x < 0 || y < 0) throw hresult_invalid_argument();
                    converter.move(x, y);
                    crop = {x, y, x + crop.right - crop.left, y + crop.bottom - crop.top};
                    inputs.region(crop);
                    pointer.split();
                } else if (verb == "input-flags") {
                    unsigned value = 0; input >> value;
                    if (!input) throw hresult_invalid_argument();
                    input >> std::ws; if (!input.eof()) throw hresult_invalid_argument();
                    if(cameraPrimary && value) throw hresult_invalid_argument();
                    inputs.configure(value); inputFlags = value;
                    inputs.drain(timeline, writer.frames * rate / fps);
                } else if (verb == "snapshot") {
                    annotationFrame(annotationBuffer.get(), converter.width, converter.height, path + L".annotation.rgba");
                } else if (verb == "gain") {
                    double a = 1, b = 1; input >> a >> b;
                    if (!input || !std::isfinite(a) || !std::isfinite(b) || a < 0 || a > 2 || b < 0 || b > 2) throw hresult_invalid_argument();
                    mixer.gain = {a, b};
                } else if (verb != "pause" && verb != "resume" && verb != "mark") throw hresult_invalid_argument();
                progress("ack", id, verb == "crop");
            }
            const auto now = clockTime();
            if (now - reportAt >= 2500000) {
                stage = L"检查录制来源";
                if(source) source->validate(); else primaryCamera->validate();
                progress("progress"); reportAt = now; levels = {};
                stage = L"检查录制磁盘";
                ULARGE_INTEGER space{}; check_bool(GetDiskFreeSpaceEx(std::filesystem::path(path).parent_path().c_str(), &space, nullptr, nullptr));
                if (space.QuadPart < 64ull * 1024 * 1024 || fileBytes(path)+(camera ? fileBytes(cameraPath) : 0) >= 1024ull * 1024 * 1024 - 32 * 1024 * 1024) {
                    warning = L"磁盘余量或录制容量不足，已结束并保留录制"; stopped = true;
                }
            }
            if (writer.frames >= uint64_t(fps) * 3600) { warning = L"已达到 60 分钟上限"; stopped = true; }
            HANDLE events[3]{controls->event.value}; DWORD count = 1;
            if (!paused) for (auto& endpoint : endpoints) if (endpoint) events[count++] = endpoint->event.value;
            WaitForMultipleObjects(count, events, FALSE, 4);
        }
        if (!paused && !canceled) drain();
    } catch (const hresult_error& error) {
        std::wostringstream detail; detail << stage << L"失败 (0x" << std::hex << uint32_t(error.code()) << L"): " << error.message().c_str(); warning = detail.str();
    }
      catch (const std::exception& error) { warning = to_hstring(error.what()); }
    for (auto& endpoint : endpoints) if (endpoint && endpoint->client) endpoint->client->Stop();
    inputs.enable(false);
    if (canceled) return;
    try { inputs.drain(timeline, writer.frames * rate / fps); } catch (const hresult_error& error) { if (warning.empty()) warning = error.message(); }
    if (!warning.empty()) std::cerr << "Capture interrupted after " << writer.frames << " frames: " << to_string(warning) << "\n";
    camera.reset();
    primaryCamera.reset();
    pointer.finish();
    audioUntil(writer.frames * rate / fps); stems.finish(writer.frames * rate / fps); writer.finish();
    if(cameraWriter) cameraWriter->finish();
    uint64_t discontinuities = 0; for (auto& endpoint : endpoints) if (endpoint) discontinuities += endpoint->discontinuities;
    if (warning.empty() && discontinuities) warning = L"采集中检测到声音不连续，请检查预览";
    std::cout << "{\"kind\":\"done\",\"samples\":" << writer.frames * rate / fps << ",\"bytes\":" << fileBytes(path)
        << ",\"warning\":" << jsonString(warning) << ",\"discontinuities\":" << discontinuities << ",\"late\":" << mixer.late;
    if(cameraWriter) std::cout << ",\"cameraBytes\":" << fileBytes(cameraPath) << ",\"cameraSamples\":" << cameraWriter->frames*rate/fps;
    std::cout << "}\n" << std::flush;
}
// Read-only session/capture diagnostics. No media, device audio or cursor pixels are saved.
static void diagnose() {
    std::cout << "{\"rdpSession\":" << (GetSystemMetrics(SM_REMOTESESSION) ? "true" : "false");
    CURSORINFO cursor{sizeof(cursor)};
    const bool cursorRead=GetCursorInfo(&cursor)!=FALSE; const DWORD cursorError=cursorRead?0:GetLastError();
    std::cout << ",\"cursorRead\":" << (cursorRead?"true":"false") << ",\"cursorError\":" << cursorError;
    if(cursorRead && cursor.hCursor) {
        ICONINFO icon{}; const bool shape=GetIconInfo(cursor.hCursor,&icon)!=FALSE; const DWORD shapeError=shape?0:GetLastError();
        if(icon.hbmColor) DeleteObject(icon.hbmColor); if(icon.hbmMask) DeleteObject(icon.hbmMask);
        std::cout << ",\"cursorShape\":" << (shape?"true":"false") << ",\"cursorShapeError\":" << shapeError;
    }
    HMONITOR monitor=MonitorFromPoint(POINT{0,0},MONITOR_DEFAULTTOPRIMARY);
    try {
        GPU gpu; VideoSource source(gpu,L"screen",reinterpret_cast<uint64_t>(monitor),0,false);
        std::cout << ",\"capture\":true,\"width\":" << source.width() << ",\"height\":" << source.height();
    } catch(const hresult_error& error) {
        std::cout << ",\"capture\":false,\"hresult\":" << uint32_t(error.code()) << ",\"message\":" << jsonString(error.message());
    }
    std::cout << "}\n" << std::flush;
}
static void inspect(const std::wstring& path, bool encoded = false) {
    com_ptr<IMFSourceReader> reader; check_hresult(MFCreateSourceReaderFromURL(path.c_str(), nullptr, reader.put()));
    check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE));
    check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM, TRUE));
    com_ptr<IMFMediaType> native; check_hresult(reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, native.put()));
    UINT width = 0, height = 0; check_hresult(MFGetAttributeSize(native.get(), MF_MT_FRAME_SIZE, &width, &height));
    com_ptr<IMFMediaType> decoded; check_hresult(MFCreateMediaType(decoded.put()));
    check_hresult(decoded->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video)); check_hresult(decoded->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12));
    if (!encoded) check_hresult(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, decoded.get()));
    uint64_t count = 0, red = 0, blue = 0; LONGLONG last = -1, end = 0;
    for (;;) {
        DWORD flags = 0; LONGLONG timestamp = 0; com_ptr<IMFSample> sample;
        check_hresult(reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, nullptr, &flags, &timestamp, sample.put()));
        if (sample) {
            if (timestamp <= last) throw hresult_error(E_FAIL, L"视频时间戳没有递增"); last = timestamp;
            LONGLONG duration = 0; sample->GetSampleDuration(&duration); end = timestamp + duration;
            if (!encoded) {
            com_ptr<IMFMediaBuffer> buffer; check_hresult(sample->ConvertToContiguousBuffer(buffer.put()));
            BYTE* data = nullptr; DWORD length = 0; check_hresult(buffer->Lock(&data, nullptr, &length));
            if (length < width * height * 3 / 2) { buffer->Unlock(); throw hresult_invalid_argument(); }
            const auto chroma = width * height + (height / 4) * width + ((width / 2) & ~1u);
            const auto u = data[chroma], v = data[chroma + 1];
            if (v > u + 50) red++; if (u > v + 50) blue++;
            buffer->Unlock();
            }
            count++;
        }
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) break;
    }
    std::cout << "{\"width\":" << width << ",\"height\":" << height << ",\"frames\":" << count
        << ",\"red\":" << red << ",\"blue\":" << blue << ",\"duration\":" << double(end) / 10000000 << "}\n";
}
// Re-author complete encoded fragments into a finalized MP4. H.264/AAC packets
// keep their timestamps and payload; recovery does not recompress the recording.
static void repair(const std::wstring& input, const std::wstring& output) {
    if (input == output || fileBytes(input) > 1024ull * 1024 * 1024) throw hresult_invalid_argument();
    com_ptr<IMFSourceReader> reader; checked(MFCreateSourceReaderFromURL(input.c_str(), nullptr, reader.put()), L"Open incomplete MP4");
    check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE));
    com_ptr<IMFMediaType> video, audio; DWORD videoIndex = MAXDWORD, audioIndex = MAXDWORD;
    // Source-reader stream indexes need not match the writer's indexes.
    for (DWORD index = 0; index < 3; index++) {
        com_ptr<IMFMediaType> native; const auto result = reader->GetNativeMediaType(index, 0, native.put());
        if (result == MF_E_INVALIDSTREAMNUMBER) break;
        checked(result, L"Read incomplete MP4 type");
        GUID major{}, subtype{}; check_hresult(native->GetGUID(MF_MT_MAJOR_TYPE, &major)); check_hresult(native->GetGUID(MF_MT_SUBTYPE, &subtype));
        if (major == MFMediaType_Video && subtype == MFVideoFormat_H264 && !video) { video = native; videoIndex = index; }
        else if (major == MFMediaType_Audio && subtype == MFAudioFormat_AAC && !audio) { audio = native; audioIndex = index; }
        else throw hresult_error(E_INVALIDARG, L"Unsupported recovery stream");
    }
    if (!video) throw hresult_error(E_INVALIDARG, L"Missing H264 recovery stream");
    const bool sound = bool(audio);
    com_ptr<IMFByteStream> bytes;
    check_hresult(MFCreateFile(MF_ACCESSMODE_WRITE, MF_OPENMODE_FAIL_IF_EXIST, MF_FILEFLAGS_NONE, output.c_str(), bytes.put()));
    com_ptr<IMFMediaSink> media; checked(MFCreateMPEG4MediaSink(bytes.get(), video.get(), sound ? audio.get() : nullptr, media.put()), L"Create repaired MP4 sink");
    com_ptr<IMFAttributes> attributes; check_hresult(MFCreateAttributes(attributes.put(), 1));
    check_hresult(attributes->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE));
    com_ptr<IMFSinkWriter> writer; checked(MFCreateSinkWriterFromMediaSink(media.get(), attributes.get(), writer.put()), L"Create repaired MP4 writer");
    checked(writer->SetInputMediaType(0, video.get(), nullptr), L"Set repaired H264 type");
    check_hresult(reader->SetStreamSelection(videoIndex, TRUE));
    if (sound) { checked(writer->SetInputMediaType(1, audio.get(), nullptr), L"Set repaired AAC type"); check_hresult(reader->SetStreamSelection(audioIndex, TRUE)); }
    checked(writer->BeginWriting(), L"Begin repaired MP4");
    bool ended[2]{}; unsigned remaining = sound ? 2 : 1; uint64_t count = 0; LONGLONG last[2]{-1,-1};
    while (remaining) {
        DWORD stream = 0, flags = 0; LONGLONG timestamp = 0; com_ptr<IMFSample> sample;
        checked(reader->ReadSample(MF_SOURCE_READER_ANY_STREAM, 0, &stream, &flags, &timestamp, sample.put()), L"Read incomplete MP4 sample");
        const DWORD destination = stream == videoIndex ? 0 : stream == audioIndex ? 1 : MAXDWORD;
        if (destination > 1 || ++count > 2'000'000 || (sample && (timestamp < 0 || timestamp > 3600ll * 10000000)) ||
            (flags & (MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED | MF_SOURCE_READERF_ERROR))) throw hresult_error(E_INVALIDARG, L"Invalid recovered stream or timestamp");
        if (sample) {
            if (timestamp <= last[destination]) throw hresult_error(E_INVALIDARG, L"Recovered timestamps not increasing"); last[destination] = timestamp;
            checked(writer->WriteSample(destination, sample.get()), L"Repair MP4 sample");
        }
        if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) && !ended[destination]) {
            ended[destination] = true; remaining--; check_hresult(reader->SetStreamSelection(stream, FALSE));
        }
    }
    checked(writer->Finalize(), L"Finalize repaired MP4"); writer = nullptr;
    const auto shutdown = media->Shutdown(); if (shutdown != MF_E_SHUTDOWN) checked(shutdown, L"Shutdown repaired MP4"); media = nullptr; bytes = nullptr;
    Handle file{CreateFileW(output.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)};
    if (file.value == INVALID_HANDLE_VALUE) throw_last_error(); check_bool(FlushFileBuffers(file.value));
    inspect(output, true);
}
int wmain(int argc, wchar_t** argv) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    try {
        init_apartment(apartment_type::multi_threaded); check_hresult(MFStartup(MF_VERSION));
        if (argc == 2 && std::wstring(argv[1]) == L"cameras") listCameras();
        else if(argc==2 && std::wstring(argv[1])==L"diagnose") diagnose();
        else if(argc==4 && (std::wstring(argv[1])==L"camera-preview" || std::wstring(argv[1])==L"camera-preview-test")) {
            const std::wstring id=argv[2];if(id.empty() || id.size()>2048) throw hresult_invalid_argument();
            Handle parent(OpenProcess(SYNCHRONIZE,FALSE,DWORD(integer(argv[3]))));if(!parent.value) throw_last_error();
            _setmode(_fileno(stdout),_O_BINARY);
            auto stopped=std::make_shared<std::atomic_bool>(false);
            std::thread([stopped] {std::string line;std::getline(std::cin,line);*stopped=true;}).detach();
            GPU gpu;CameraSource camera(gpu,id,std::wstring(argv[1])==L"camera-preview-test");
            while(!*stopped && WaitForSingleObject(parent.value,0)==WAIT_TIMEOUT) {
                camera.fixtureFrame(clockTime());camera.validate();camera.preview(L"");Sleep(100);
            }
        }
        else if(argc==3&&std::wstring(argv[1])==L"cursor-test") {CursorTracker::selfTest(argv[2]);std::cout<<"{\"cursorTest\":true}\n";}
        else if(argc==4&&(std::wstring(argv[1])==L"cursor-animation-test"||std::wstring(argv[1])==L"cursor-static-test")) {
            bool supported=CursorTracker::animationTest(argv[2],argv[3],std::wstring(argv[1])==L"cursor-static-test");
            std::cout<<"{\"cursorAnimation\":"<<(supported?"true":"false")<<"}\n";
        }
        else if (argc == 3 && std::wstring(argv[1]) == L"inspect") inspect(argv[2]);
        else if (argc == 4 && std::wstring(argv[1]) == L"repair") repair(argv[2], argv[3]);
        else if ((argc >= 19 && argc <= 21) && (std::wstring(argv[1]) == L"capture" || std::wstring(argv[1]) == L"capture-test")) {
            const auto inputFlags = argc >= 20 ? integer(argv[19], true) : 0;
            const std::wstring cameraId=argc==21 ? argv[20] : L"none";
            if(cameraId.empty() || cameraId.size()>2048) throw hresult_invalid_argument();
            const bool cameraPrimary=std::wstring(argv[3])==L"camera";
            if(cameraPrimary && (cameraId==L"none" || inputFlags || std::wstring(argv[17])!=L"0" || integer(argv[4],true) || integer(argv[5],true))) throw hresult_invalid_argument();
            if (inputFlags > 14 || (inputFlags & 3) == 3) throw hresult_invalid_argument();
            const auto fps = integer(argv[12]), maximum = integer(argv[11]), bitrate = integer(argv[13]), ab = integer(argv[16]);
            if ((fps != 15 && fps != 30 && fps != 60) || maximum > 2560 || maximum < 2 || bitrate < 1000000 || bitrate > 40000000 ||
                (ab != 96000 && ab != 128000 && ab != 160000 && ab != 192000)) throw hresult_invalid_argument();
            const auto x = integer(argv[7], true), y = integer(argv[8], true), w = integer(argv[9], true), h = integer(argv[10], true);
            if (x + w > 16384 || y + h > 16384 || integer(argv[5], true) > MAXDWORD || integer(argv[6]) > MAXDWORD) throw hresult_invalid_argument();
            if(cameraPrimary && (x || y || w || h)) throw hresult_invalid_argument();
            capture(argv[2], argv[3], integer(argv[4],cameraPrimary), DWORD(integer(argv[5], true)), DWORD(integer(argv[6])),
                RECT{LONG(x), LONG(y), LONG(x + w), LONG(y + h)}, UINT(maximum), UINT(fps), UINT(bitrate), argv[14], argv[15], UINT(ab),
                std::wstring(argv[17]) == L"1", std::wstring(argv[18]) == L"auto", std::wstring(argv[1]) == L"capture-test", unsigned(inputFlags),cameraId);
        } else throw hresult_invalid_argument();
        MFShutdown(); uninit_apartment(); return 0;
    } catch (const hresult_error& error) {
        std::cerr << "Video failed (0x" << std::hex << unsigned(error.code()) << "): " << to_string(error.message()) << std::endl;
    } catch (const std::exception& error) { std::cerr << "Video failed: " << error.what() << std::endl; }
    return 1;
}
