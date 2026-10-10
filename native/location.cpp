#include <windows.h>
#include <cmath>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Devices.Geolocation.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Devices::Geolocation;
namespace {
// Called only on Electron's foreground UI thread. Never block that thread on WinRT.
struct Result { uint32_t state; int32_t error; double latitude, longitude, accuracy; };
static_assert(sizeof(Result) == 32);
DWORD owner = 0;
uint32_t serial = 0, active = 0;
IAsyncOperation<GeolocationAccessStatus> access{nullptr};
IAsyncOperation<Geoposition> position{nullptr};
Geolocator locator{nullptr};
Result result{};
void clear() noexcept {
    try { if (access) access.Cancel(); } catch (...) {}
    try { if (position) position.Cancel(); } catch (...) {}
    access = nullptr; position = nullptr; locator = nullptr;
}
void failure(hresult code) noexcept {
    result.error = code;
    result.state = code == E_ACCESSDENIED ? 3 : code == HRESULT_FROM_WIN32(ERROR_TIMEOUT) ? 5 : 4;
    clear();
}
}
extern "C" __declspec(dllexport) uint32_t one_location_begin() noexcept {
    if (owner && owner != GetCurrentThreadId()) return 0;
    owner = GetCurrentThreadId(); clear(); result = {1, 0, 0, 0, 0};
    active = ++serial; if (!active) active = ++serial;
    try {
        APTTYPE type; APTTYPEQUALIFIER qualifier;
        if (CoGetApartmentType(&type, &qualifier) == CO_E_NOTINITIALIZED) {
            check_hresult(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED));
        }
        access = Geolocator::RequestAccessAsync();
    } catch (...) { failure(to_hresult()); }
    return active;
}
extern "C" __declspec(dllexport) uint32_t one_location_poll(uint32_t token, void* output, uint32_t size) noexcept {
    if (!output || size != sizeof(Result)) return 0;
    if (!token || token != active || owner != GetCurrentThreadId()) {
        *static_cast<Result*>(output) = {6, 0, 0, 0, 0}; return 1;
    }
    try {
        if (result.state == 1 && access) {
            auto status = access.Status();
            if (status == AsyncStatus::Error) { failure(access.ErrorCode()); }
            else if (status == AsyncStatus::Canceled) { result.state = 6; clear(); }
            else if (status == AsyncStatus::Completed) {
                auto permission = access.GetResults(); access = nullptr;
                if (permission != GeolocationAccessStatus::Allowed) { result.state = permission == GeolocationAccessStatus::Denied ? 3 : 4; }
                else {
                    locator = Geolocator(); locator.DesiredAccuracy(PositionAccuracy::Default);
                    position = locator.GetGeopositionAsync(std::chrono::minutes(1), std::chrono::seconds(20));
                }
            }
        }
        if (result.state == 1 && position) {
            auto status = position.Status();
            if (status == AsyncStatus::Error) { failure(position.ErrorCode()); }
            else if (status == AsyncStatus::Canceled) { result.state = 6; clear(); }
            else if (status == AsyncStatus::Completed) {
                auto coordinate = position.GetResults().Coordinate(); auto point = coordinate.Point().Position();
                result = {2, 0, point.Latitude, point.Longitude, coordinate.Accuracy()}; clear();
            }
        }
    } catch (...) { failure(to_hresult()); }
    *static_cast<Result*>(output) = result; return 1;
}
extern "C" __declspec(dllexport) void one_location_cancel(uint32_t token) noexcept {
    if (token == active && owner == GetCurrentThreadId()) { result.state = 6; clear(); active = 0; }
}
