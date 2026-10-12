#pragma once
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace one_audio {
constexpr int rate = 48000, channels = 2, capacity = rate;
// WASAPI packet QPC positions and our clock use the same 100 ns unit. Every
// resume starts a new wall-clock segment at the last committed output sample.
struct Timeline {
    int64_t epoch = 0, base = 0;
    void begin(int64_t now, int64_t written) { epoch = now; base = written; }
    int64_t position(int64_t timestamp) const {
        return base + int64_t(std::llround(double(timestamp - epoch) * rate / 10000000.0));
    }
};
// QPC anchors a stream to video and the other endpoint. Individual QPC packet
// timestamps jitter; the device's frame counter keeps contiguous PCM contiguous.
struct PacketClock {
    bool anchored = false;
    uint64_t nextDevice = 0;
    int64_t nextSample = 0;
    void reset() { anchored = false; }
    int64_t place(uint64_t device, int frames, int64_t qpcSample) {
        if (!anchored || device != nextDevice) nextSample = qpcSample;
        const auto start = nextSample;
        nextDevice = device + frames; nextSample += frames; anchored = true;
        return start;
    }
};
struct Level { double system = 0, microphone = 0, mixed = 0; bool clipped = false; };
class Mixer {
    struct Slot { int64_t tag = -1; std::array<float, 2> value{}; };
    std::array<std::vector<Slot>, 2> inputs{std::vector<Slot>(capacity), std::vector<Slot>(capacity)};
public:
    int64_t written = 0;
    std::array<double, 2> gain{1, 1};
    uint64_t late = 0;
    void reset() { for (auto& input : inputs) for (auto& slot : input) slot.tag = -1; }
    void put(int source, int64_t start, const float* values, int frames, bool silent) {
        if (source < 0 || source > 1 || frames < 0 || frames > capacity || (!silent && frames && !values)) throw std::runtime_error("Invalid audio packet");
        if (start + frames > written + capacity) throw std::runtime_error("Audio timestamp exceeded buffer");
        for (int i = 0; i < frames; i++) {
            const auto position = start + i;
            if (position < written) { late++; continue; }
            auto& slot = inputs[source][size_t(position % capacity)];
            slot.tag = position;
            for (int c = 0; c < channels; c++) {
                const float value = silent ? 0 : values[i * channels + c];
                slot.value[c] = std::isfinite(value) ? value : 0;
            }
        }
    }
    std::vector<int16_t> take(int frames, Level& level, std::array<std::vector<int16_t>, 2>* sources = nullptr) {
        if (frames < 1 || frames > 960) throw std::runtime_error("Invalid audio block");
        std::vector<int16_t> pcm(size_t(frames) * channels);
        if (sources) for (auto& source : *sources) source.resize(pcm.size());
        for (int i = 0; i < frames; i++, written++) {
            for (int c = 0; c < channels; c++) {
                double values[2]{};
                for (int s = 0; s < 2; s++) {
                    const auto& slot = inputs[s][size_t(written % capacity)];
                    const double raw = slot.tag == written ? slot.value[c] : 0;
                    // Source tracks are pre-fader: live mute/gain changes only
                    // affect the mixed original, so editing can recover a source.
                    if (sources) (*sources)[s][size_t(i) * channels + c] = int16_t(std::lround(std::clamp(raw, -1.0, 1.0) * 32767));
                    values[s] = raw * gain[s];
                }
                level.system = std::max(level.system, std::abs(values[0]));
                level.microphone = std::max(level.microphone, std::abs(values[1]));
                const auto mixed = values[0] + values[1];
                level.mixed = std::max(level.mixed, std::abs(mixed));
                level.clipped |= std::abs(mixed) > 1;
                pcm[size_t(i) * channels + c] = int16_t(std::lround(std::clamp(mixed, -1.0, 1.0) * 32767));
            }
        }
        return pcm;
    }
};
}
