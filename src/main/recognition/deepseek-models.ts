import type { LocalModelDescriptor } from '../../shared/local-models';
export interface DeepSeekOCRPreset extends LocalModelDescriptor { generation:'v1'|'v2'; memoryBudgetMiB:number; contextTokens:number; outputTokens:number }
/** Fixed, qualified community GGUF conversions of the original MIT-licensed models. */
export const deepseekOCRPresets: readonly DeepSeekOCRPreset[] = [
  {
    "id": "deepseek-ocr-v1",
    "revision": "q8-7086620c-b11588",
    "title": "DeepSeek OCR",
    "size": "v1 · 3B",
    "purpose": "ocr",
    "generation": "v1",
    "languages": [
      "中文",
      "English"
    ],
    "precision": "q8_0",
    "runtime": "llama.cpp@b11588",
    "backends": [
      "cpu",
      "cuda"
    ],
    "memoryBudgetMiB": 8192,
    "measuredMemoryMiB": 4993,
    "contextTokens": 16384,
    "outputTokens": 8192,
    "weightLicense": {
      "name": "MIT",
      "source": "https://huggingface.co/deepseek-ai/DeepSeek-OCR"
    },
    "artifacts": [
      {
        "name": "language.gguf",
        "role": "language",
        "url": "https://huggingface.co/ggml-org/DeepSeek-OCR-GGUF/resolve/7086620c3e417c744eb30dd3090fd053c6bb2e5e/DeepSeek-OCR-Q8_0.gguf",
        "bytes": 3126139712,
        "sha256": "81ede3e256230707dccf7fa052570c3a939d57db99de655f43cbb1a830d14d92"
      },
      {
        "name": "vision.gguf",
        "role": "vision",
        "url": "https://huggingface.co/ggml-org/DeepSeek-OCR-GGUF/resolve/7086620c3e417c744eb30dd3090fd053c6bb2e5e/mmproj-DeepSeek-OCR-Q8_0.gguf",
        "bytes": 447856768,
        "sha256": "786c9b5159898de3d1d94a102836df559fed0bcf09f41a32f62c3219b0e278e0"
      }
    ]
  },
  {
    "id": "deepseek-ocr-v2",
    "revision": "q8-d08e5af4-b11588",
    "title": "DeepSeek OCR",
    "size": "v2 · 3B",
    "purpose": "ocr",
    "generation": "v2",
    "languages": [
      "中文",
      "English"
    ],
    "precision": "q8_0",
    "runtime": "llama.cpp@b11588",
    "backends": [
      "cpu",
      "cuda"
    ],
    "memoryBudgetMiB": 8192,
    "measuredMemoryMiB": 5909,
    "contextTokens": 16384,
    "outputTokens": 8192,
    "weightLicense": {
      "name": "MIT",
      "source": "https://huggingface.co/deepseek-ai/DeepSeek-OCR-2"
    },
    "artifacts": [
      {
        "name": "language.gguf",
        "role": "language",
        "url": "https://huggingface.co/sabafallah/DeepSeek-OCR-2-GGUF/resolve/d08e5af400c64fa8a9b89b04ba373b600b02e05d/deepseek-ocr-2-q8_0.gguf",
        "bytes": 3126139808,
        "sha256": "4d82d12b949a6256a66eed9874a8177a9a25d1fe1b0650dfaaf34c9b92d9b911"
      },
      {
        "name": "vision.gguf",
        "role": "vision",
        "url": "https://huggingface.co/sabafallah/DeepSeek-OCR-2-GGUF/resolve/d08e5af400c64fa8a9b89b04ba373b600b02e05d/mmproj-deepseek-ocr-2-q8_0.gguf",
        "bytes": 512537792,
        "sha256": "46efe1304f581869f3b067eb77b1151dc0daf32bc25ef644fc7d505f4153a545"
      }
    ]
  }
];
