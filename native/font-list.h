#pragma once
#include <dwrite.h>
#include <wrl/client.h>
#pragma comment(lib, "dwrite.lib")

// Read the Windows font collection, including localized family names.
inline void fontList() {
  using Microsoft::WRL::ComPtr;
  ComPtr<IDWriteFactory> factory;
  if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
      reinterpret_cast<IUnknown**>(factory.GetAddressOf())))) throw std::runtime_error("Cannot read Windows fonts");
  ComPtr<IDWriteFontCollection> collection;
  if (FAILED(factory->GetSystemFontCollection(&collection, TRUE))) throw std::runtime_error("Cannot read installed fonts");
  wchar_t locale[LOCALE_NAME_MAX_LENGTH] = L"en-us";
  GetUserDefaultLocaleName(locale, LOCALE_NAME_MAX_LENGTH);
  std::cout << '[';
  bool comma = false;
  for (UINT32 i = 0; i < collection->GetFontFamilyCount(); ++i) {
    ComPtr<IDWriteFontFamily> family;
    ComPtr<IDWriteLocalizedStrings> names;
    if (FAILED(collection->GetFontFamily(i, &family)) || FAILED(family->GetFamilyNames(&names)) || !names->GetCount()) continue;
    auto indexFor = [&](const wchar_t* language, UINT32 fallback) {
      UINT32 index = 0; BOOL exists = FALSE;
      return SUCCEEDED(names->FindLocaleName(language, &index, &exists)) && exists ? index : fallback;
    };
    auto nameAt = [&](UINT32 index) {
      UINT32 length = 0;
      if (FAILED(names->GetStringLength(index, &length)) || !length || length > 256) return std::wstring();
      std::wstring value(length + 1, L'\0');
      if (FAILED(names->GetString(index, value.data(), length + 1))) return std::wstring();
      value.resize(length); return value;
    };
    const auto english = indexFor(L"en-us", 0);
    const auto canonical = nameAt(english), label = nameAt(indexFor(locale, english));
    if (canonical.empty() || label.empty() || canonical.front() == L'@') continue;
    if (comma) std::cout << ','; comma = true;
    std::cout << "{\"family\":" << quoted(canonical) << ",\"label\":" << quoted(label) << ",\"aliases\":[";
    std::set<std::wstring> aliases;
    for (UINT32 j = 0; j < names->GetCount(); ++j) { auto name = nameAt(j); if (!name.empty()) aliases.insert(name); }
    bool separator = false;
    for (const auto& alias : aliases) { if (separator) std::cout << ','; separator = true; std::cout << quoted(alias); }
    std::cout << "]}";
  }
  std::cout << "]\n";
}

inline void fontSource(const wchar_t* name) {
  using Microsoft::WRL::ComPtr;
  ComPtr<IDWriteFactory> factory;
  if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(factory.GetAddressOf())))) throw std::runtime_error("Cannot read Windows fonts");
  ComPtr<IDWriteFontCollection> collection;
  if (FAILED(factory->GetSystemFontCollection(&collection, TRUE))) throw std::runtime_error("Cannot read installed fonts");
  UINT32 index = 0; BOOL exists = FALSE;
  if (FAILED(collection->FindFamilyName(name, &index, &exists)) || !exists) { std::cout << "null\n"; return; }
  ComPtr<IDWriteFontFamily> family; ComPtr<IDWriteFont> font; ComPtr<IDWriteFontFace> face;
  if (FAILED(collection->GetFontFamily(index, &family)) || FAILED(family->GetFirstMatchingFont(DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, &font)) || FAILED(font->CreateFontFace(&face))) throw std::runtime_error("Cannot open installed font");
  auto info = [&](DWRITE_INFORMATIONAL_STRING_ID id) {
    ComPtr<IDWriteLocalizedStrings> strings; BOOL found = FALSE;
    if (FAILED(font->GetInformationalStrings(id, &strings, &found)) || !found || !strings->GetCount()) return std::wstring();
    UINT32 i = 0, length = 0; strings->FindLocaleName(L"en-us", &i, &found); if (!found) i = 0;
    if (FAILED(strings->GetStringLength(i, &length)) || length > 512) return std::wstring();
    std::wstring result(length + 1, L'\0'); if (FAILED(strings->GetString(i, result.data(), length + 1))) return std::wstring(); result.resize(length); return result;
  };
  std::wstring path; UINT32 count = 0;
  if (SUCCEEDED(face->GetFiles(&count, nullptr)) && count == 1) {
    ComPtr<IDWriteFontFile> file;
    if (SUCCEEDED(face->GetFiles(&count, file.GetAddressOf()))) {
      const void* key = nullptr; UINT32 keySize = 0; ComPtr<IDWriteFontFileLoader> loader; ComPtr<IDWriteLocalFontFileLoader> local;
      if (SUCCEEDED(file->GetReferenceKey(&key, &keySize)) && SUCCEEDED(file->GetLoader(&loader)) && SUCCEEDED(loader.As(&local))) {
        UINT32 length = 0;
        if (SUCCEEDED(local->GetFilePathLengthFromKey(key, keySize, &length)) && length < 32768) {
          path.resize(length + 1);
          if (SUCCEEDED(local->GetFilePathFromKey(key, keySize, path.data(), length + 1))) path.resize(length); else path.clear();
        }
      }
    }
  }
  std::cout << "{\"path\":" << quoted(path) << ",\"index\":" << face->GetIndex() << ",\"postscript\":" << quoted(info(DWRITE_INFORMATIONAL_STRING_POSTSCRIPT_NAME)) << ",\"fullName\":" << quoted(info(DWRITE_INFORMATIONAL_STRING_FULL_NAME)) << "}\n";
}
