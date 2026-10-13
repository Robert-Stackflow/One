#pragma once
#include <dxgi1_4.h>
#include <d3d12.h>

// Keep the raw EnumAdapters1 index: it is the device_id consumed by ONNX Runtime DirectML.
// D3D12 capability is only a prerequisite; each model still needs actual DirectML validation.
static bool inferenceDevices() {
 Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
 if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
 const auto library = LoadLibraryExW(L"d3d12.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
 using CreateDevice = HRESULT(WINAPI*)(IUnknown*, D3D_FEATURE_LEVEL, REFIID, void**);
 const auto createDevice = library ? reinterpret_cast<CreateDevice>(GetProcAddress(library, "D3D12CreateDevice")) : nullptr;
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
         << ",\"d3d12\":" << (d3d12 ? "true" : "false") << '}';
 }
 if (library) FreeLibrary(library);
 if (!ok) return false;
 output << ']'; std::cout << output.str() << std::endl;
 return true;
}
