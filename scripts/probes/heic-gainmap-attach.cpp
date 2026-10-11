// Research probe for libheif 1.23.5 with libheif-aux-writer.patch applied.
// Re-encodes a public Apple HEIC as a 2x2 grid and attaches its HDR gain map.
#include <libheif/heif.h>
#include <libheif/heif_aux_images.h>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <vector>

static bool ok(heif_error e, const char* step) {
  if (e.code == heif_error_Ok) return true;
  std::fprintf(stderr, "%s: %s\n", step, e.message);
  return false;
}

int main(int argc, char** argv) {
  if (argc != 3 && !(argc == 4 && (std::strcmp(argv[3], "--raw-gain") == 0 ||
                                    std::strcmp(argv[3], "--raw-gain-pad") == 0 ||
                                    std::strcmp(argv[3], "--raw-both") == 0))) return 2;
  const bool rawGain = argc == 4;
  const bool rawBoth = rawGain && std::strcmp(argv[3], "--raw-both") == 0;
  const bool padGain = rawGain && std::strcmp(argv[3], "--raw-gain-pad") == 0;
  auto* source = heif_context_alloc();
  auto* target = heif_context_alloc();
  heif_image_handle *main = nullptr, *gain = nullptr, *encoded = nullptr, *encodedGain = nullptr;
  heif_image *mainPixels = nullptr, *gainPixels = nullptr;
  heif_encoder* encoder = nullptr;
  if (!ok(heif_context_read_from_file(source, argv[1], nullptr), "read") ||
      !ok(heif_context_get_primary_image_handle(source, &main), "main") ||
      heif_image_handle_get_number_of_auxiliary_images(main, 0) != 1) return 1;
  heif_item_id id{};
  heif_image_handle_get_list_of_auxiliary_image_IDs(main, 0, &id, 1);
  if (!ok(heif_image_handle_get_auxiliary_image_handle(main, id, &gain), "gain")) return 1;
  const char* type = nullptr;
  if (!ok(heif_image_handle_get_auxiliary_type(gain, &type), "gain type")) return 1;
  if (!type || std::strcmp(type, "urn:com:apple:photo:2020:aux:hdrgainmap") != 0) return 2;
  heif_decoding_options* gainOptions = rawGain ? heif_decoding_options_alloc() : nullptr;
  if (gainOptions) gainOptions->ignore_transformations = 1;
  heif_decoding_options* mainOptions = rawBoth ? heif_decoding_options_alloc() : nullptr;
  if (mainOptions) mainOptions->ignore_transformations = 1;
  if (!ok(heif_decode_image(main, &mainPixels, heif_colorspace_YCbCr, heif_chroma_420, mainOptions), "decode main") ||
      !ok(heif_decode_image(gain, &gainPixels, heif_colorspace_undefined, heif_chroma_undefined, gainOptions), "decode gain") ||
      !ok(heif_context_get_encoder_for_format(target, heif_compression_HEVC, &encoder), "encoder") ||
      !ok(heif_encoder_set_lossy_quality(encoder, 100), "quality")) return 1;
  heif_decoding_options_free(gainOptions);
  heif_decoding_options_free(mainOptions);
  if (padGain && !ok(heif_image_extend_to_size_fill_with_zero(gainPixels,
                      heif_image_get_width(gainPixels, heif_channel_Y),
                      (heif_image_get_height(gainPixels, heif_channel_Y) + 7) & ~7), "pad gain")) return 1;
  const size_t iccSize = heif_image_handle_get_raw_color_profile_size(main);
  if (iccSize > 128 * 1024) return 2;
  std::vector<unsigned char> icc(iccSize);
  if (iccSize && (!ok(heif_image_handle_get_raw_color_profile(main, icc.data()), "read ICC") ||
                  !ok(heif_image_set_raw_color_profile(mainPixels, "prof", icc.data(), icc.size()), "set ICC"))) return 1;
  const int width = heif_image_get_width(mainPixels, heif_channel_Y);
  const int height = heif_image_get_height(mainPixels, heif_channel_Y);
  if (width <= 0 || height <= 0 || width % 4 || height % 4) return 2;
  heif_image* tiles[4]{};
  for (int y = 0; y < 2; ++y) for (int x = 0; x < 2; ++x) {
    if (!ok(heif_image_extract_area(mainPixels, x * width / 2, y * height / 2,
                                    width / 2, height / 2, nullptr, &tiles[y * 2 + x]), "tile")) return 1;
  }
  if (!ok(heif_context_encode_grid(target, tiles, 2, 2, encoder, nullptr, &encoded), "encode grid")) return 1;
  for (auto* tile : tiles) heif_image_release(tile);
  if (rawBoth && !ok(heif_context_add_rotation_probe(target, encoded, 270), "rotate main")) return 1;
  if (!ok(heif_context_add_auxiliary_image_probe(target, encoded, gainPixels, encoder, type,
                                                  rawGain ? 270 : 0, &encodedGain), "attach gain")) return 1;
  const int count = heif_image_handle_get_number_of_metadata_blocks(gain, nullptr);
  if (count != 1) return 2;
  heif_item_id metadataId{};
  heif_image_handle_get_list_of_metadata_block_IDs(gain, nullptr, &metadataId, 1);
  const char* metadataType = heif_image_handle_get_metadata_type(gain, metadataId);
  const char* contentType = heif_image_handle_get_metadata_content_type(gain, metadataId);
  if (!metadataType || !contentType || std::strcmp(metadataType, "mime") != 0 ||
      std::strcmp(contentType, "application/rdf+xml") != 0) return 2;
  const size_t size = heif_image_handle_get_metadata_size(gain, metadataId);
  if (size == 0 || size > 1024 * 1024) return 2;
  std::vector<unsigned char> xmp(size);
  if (!ok(heif_image_handle_get_metadata(gain, metadataId, xmp.data()), "read gain XMP") ||
      !ok(heif_context_add_XMP_metadata(target, encodedGain, xmp.data(), static_cast<int>(xmp.size())), "attach gain XMP") ||
      !ok(heif_context_write_to_file(target, argv[2]), "write")) return 1;
  auto* check = heif_context_alloc();
  heif_image_handle *checkMain = nullptr, *checkGain = nullptr;
  if (!ok(heif_context_read_from_file(check, argv[2], nullptr), "reopen") ||
      !ok(heif_context_get_primary_image_handle(check, &checkMain), "reopen main")) return 1;
  const int auxCount = heif_image_handle_get_number_of_auxiliary_images(checkMain, 0);
  if (auxCount != 1) { std::fprintf(stderr, "output aux count=%d\n", auxCount); return 1; }
  heif_item_id checkId{};
  heif_image_handle_get_list_of_auxiliary_image_IDs(checkMain, 0, &checkId, 1);
  if (!ok(heif_image_handle_get_auxiliary_image_handle(checkMain, checkId, &checkGain), "reopen gain")) return 1;
  const char* checkType = nullptr;
  if (!ok(heif_image_handle_get_auxiliary_type(checkGain, &checkType), "reopen type")) return 1;
  heif_image *checkMainPixels = nullptr, *checkGainPixels = nullptr;
  heif_decoding_options* checkGainOptions = rawGain ? heif_decoding_options_alloc() : nullptr;
  if (checkGainOptions) checkGainOptions->ignore_transformations = 1;
  if (!ok(heif_decode_image(checkMain, &checkMainPixels, heif_colorspace_YCbCr, heif_chroma_420, nullptr), "decode output main") ||
      !ok(heif_decode_image(checkGain, &checkGainPixels, heif_colorspace_undefined, heif_chroma_undefined, checkGainOptions), "decode output gain")) return 1;
  heif_decoding_options_free(checkGainOptions);
  if (heif_image_handle_get_number_of_metadata_blocks(checkGain, nullptr) != 1) {
    std::fprintf(stderr, "output gain metadata count mismatch\n"); return 1;
  }
  heif_item_id checkMetadataId{};
  heif_image_handle_get_list_of_metadata_block_IDs(checkGain, nullptr, &checkMetadataId, 1);
  const char* checkMetadataType = heif_image_handle_get_metadata_type(checkGain, checkMetadataId);
  const char* checkContentType = heif_image_handle_get_metadata_content_type(checkGain, checkMetadataId);
  if (!checkMetadataType || !checkContentType || std::strcmp(checkMetadataType, "mime") != 0 ||
      std::strcmp(checkContentType, "application/rdf+xml") != 0) {
    std::fprintf(stderr, "output gain metadata type mismatch\n"); return 1;
  }
  const size_t checkSize = heif_image_handle_get_metadata_size(checkGain, checkMetadataId);
  std::vector<unsigned char> checkXmp(checkSize);
  if (checkSize != size || !ok(heif_image_handle_get_metadata(checkGain, checkMetadataId, checkXmp.data()), "read output gain XMP")) {
    std::fprintf(stderr, "output gain XMP size mismatch\n"); return 1;
  }
  const bool xmpEqual = xmp == checkXmp;
  std::vector<unsigned char> checkIcc(heif_image_handle_get_raw_color_profile_size(checkMain));
  if (!checkIcc.empty() && !ok(heif_image_handle_get_raw_color_profile(checkMain, checkIcc.data()), "read output ICC")) return 1;
  const bool iccEqual = icc == checkIcc;
  int sourceStride = 0, outputStride = 0;
  const auto* sourceY = heif_image_get_plane_readonly(gainPixels, heif_channel_Y, &sourceStride);
  const auto* outputY = heif_image_get_plane_readonly(checkGainPixels, heif_channel_Y, &outputStride);
  const int gainWidth = heif_image_get_width(gainPixels, heif_channel_Y);
  const int gainHeight = heif_image_get_height(gainPixels, heif_channel_Y);
  const int outputGainHeight = heif_image_get_height(checkGainPixels, heif_channel_Y);
  if (!sourceY || !outputY || gainWidth != heif_image_get_width(checkGainPixels, heif_channel_Y) ||
      outputGainHeight < gainHeight || outputGainHeight > gainHeight + 64) {
    std::fprintf(stderr, "gain plane mismatch source=%dx%d output=%dx%d\n", gainWidth, gainHeight,
                 heif_image_get_width(checkGainPixels, heif_channel_Y), outputGainHeight);
    return 1;
  }
  unsigned long long errorSum = 0;
  int maximumError = 0;
  for (int y = 0; y < gainHeight; ++y) for (int x = 0; x < gainWidth; ++x) {
    const int error = std::abs(int(sourceY[y * sourceStride + x]) - int(outputY[y * outputStride + x]));
    errorSum += error;
    if (error > maximumError) maximumError = error;
  }
  std::printf("main=%dx%d gain=%dx%d type=%s gainMetadata=%d\n",
              heif_image_handle_get_width(checkMain), heif_image_handle_get_height(checkMain),
              heif_image_handle_get_width(checkGain), heif_image_handle_get_height(checkGain),
              checkType ? checkType : "", heif_image_handle_get_number_of_metadata_blocks(checkGain, nullptr));
  std::printf("mainDecoded=%dx%d gainDecoded=%dx%d ICCBytes=%zu ICCEqual=%d gainXmpBytes=%zu gainXmpEqual=%d gainMAE=%.3f gainMaxError=%d\n",
              heif_image_get_width(checkMainPixels, heif_channel_Y), heif_image_get_height(checkMainPixels, heif_channel_Y),
              heif_image_get_width(checkGainPixels, heif_channel_Y), heif_image_get_height(checkGainPixels, heif_channel_Y),
              checkIcc.size(), iccEqual, checkSize, xmpEqual, double(errorSum) / (gainWidth * gainHeight), maximumError);
  return checkType && std::strcmp(type, checkType) == 0 &&
         heif_image_handle_get_number_of_metadata_blocks(checkGain, nullptr) == 1 && xmpEqual && iccEqual ? 0 : 1;
}
