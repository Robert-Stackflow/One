#pragma once
#include <dxgi1_4.h>
#include <d3d12.h>
#include <vector>
#include <cstring>

struct InferenceCudaIdentity { LUID luid; int device; int driver; };
// Resolve CUDA's ordinal through the driver-provided Windows LUID, never a name or DXGI index.
// Loading only the installed system driver keeps enumeration independent of model/runtime downloads.
static std::vector<InferenceCudaIdentity> inferenceCudaIdentities() {
 std::vector<InferenceCudaIdentity> result;
 const auto library = LoadLibraryExW(L"nvcuda.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
 if (!library) return result;
 using Init = int(WINAPI*)(unsigned int);
 using Count = int(WINAPI*)(int*);
 using Device = int(WINAPI*)(int*, int);
 using Identity = int(WINAPI*)(char*, unsigned int*, int);
 const auto init = reinterpret_cast<Init>(GetProcAddress(library, "cuInit"));
 const auto count = reinterpret_cast<Count>(GetProcAddress(library, "cuDeviceGetCount"));
 const auto getDevice = reinterpret_cast<Device>(GetProcAddress(library, "cuDeviceGet"));
 const auto identity = reinterpret_cast<Identity>(GetProcAddress(library, "cuDeviceGetLuid"));
 const auto version = reinterpret_cast<Count>(GetProcAddress(library, "cuDriverGetVersion"));
 int devices = 0, driver = 0;
 if (init && count && getDevice && identity && version && init(0) == 0 && count(&devices) == 0 &&
     version(&driver) == 0 && devices >= 0 && devices <= 32 && driver > 0) {
  for (int index = 0; index < devices; ++index) {
   char bytes[8]{}; unsigned int mask = 0; LUID luid{}; int device = 0;
   if (getDevice(&device, index) != 0 || identity(bytes, &mask, device) != 0 || !mask || (mask & (mask - 1))) continue;
   std::memcpy(&luid, bytes, sizeof(luid));
   if (luid.LowPart || luid.HighPart) result.push_back({luid, index, driver});
  }
 }
 FreeLibrary(library); return result;
}

// Keep the raw EnumAdapters1 index: it is the device_id consumed by ONNX Runtime DirectML.
// D3D12 capability is only a prerequisite; each model still needs actual DirectML validation.
static bool inferenceDevices() {
 Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
 if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
 const auto library = LoadLibraryExW(L"d3d12.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
 using CreateDevice = HRESULT(WINAPI*)(IUnknown*, D3D_FEATURE_LEVEL, REFIID, void**);
 const auto createDevice = library ? reinterpret_cast<CreateDevice>(GetProcAddress(library, "D3D12CreateDevice")) : nullptr;
 const auto cuda = inferenceCudaIdentities();
 std::ostringstream output; output << '['; bool comma = false, ok = true;
 for (UINT index = 0; index < 32; ++index) {
  Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;
  const auto status = factory->EnumAdapters1(index, &adapter);
  if (status == DXGI_ERROR_NOT_FOUND) break;
  if (FAILED(status)) { ok = false; break; }
  DXGI_ADAPTER_DESC1 description{};
  if (FAILED(adapter->GetDesc1(&description))) { ok = false; break; }
  if (description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) continue;
  std::ostringstream identity;
  identity << std::hex << std::setfill('0') << std::setw(8) << static_cast<UINT>(description.AdapterLuid.HighPart)
           << ':' << std::setw(8) << description.AdapterLuid.LowPart;
  const bool d3d12 = createDevice && SUCCEEDED(createDevice(adapter.Get(), D3D_FEATURE_LEVEL_11_0, __uuidof(ID3D12Device), nullptr));
  if (comma) output << ','; comma = true;
  output << "{\"id\":\"" << identity.str() << "\",\"deviceId\":" << index << ",\"name\":" << json(description.Description)
         << ",\"vendorId\":" << description.VendorId << ",\"pciDeviceId\":" << description.DeviceId
         << ",\"dedicatedMemory\":" << description.DedicatedVideoMemory << ",\"sharedMemory\":" << description.SharedSystemMemory
         << ",\"d3d12\":" << (d3d12 ? "true" : "false");
  const InferenceCudaIdentity* matched = nullptr; int matches = 0;
  for (const auto& device : cuda) if (device.luid.LowPart == description.AdapterLuid.LowPart && device.luid.HighPart == description.AdapterLuid.HighPart) {
   matched = &device; ++matches;
  }
  // Linked/ambiguous devices must not silently select the first CUDA node.
  if (matches == 1 && description.VendorId == 0x10de) output << ",\"cudaDeviceId\":" << matched->device << ",\"cudaDriverVersion\":" << matched->driver;
  output << '}';
 }
 if (library) FreeLibrary(library);
 if (!ok) return false;
 output << ']'; std::cout << output.str() << std::endl;
 return true;
}
