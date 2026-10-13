// Fixed lockfile generated from SHA-256-verified official llama.cpp b11588 archives.
export interface LlamaRuntimeArchive { id:string; name:string; url:string; bytes:number; sha256:string }
export interface LlamaRuntimeFile { archive:string; entry:string; name:string; bytes:number; sha256:string }
export interface LlamaRuntimeProfile { id:string; backend:'cpu'|'cuda'; revision:string; archives:LlamaRuntimeArchive[]; files:LlamaRuntimeFile[] }
export const llamaRuntimeProfiles: readonly LlamaRuntimeProfile[] = [
  {
    "id": "llama-b11588-cpu-x64",
    "backend": "cpu",
    "revision": "b11588",
    "archives": [
      {
        "id": "cpu",
        "name": "llama-b11588-bin-win-cpu-x64.zip",
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b11588/llama-b11588-bin-win-cpu-x64.zip",
        "bytes": 19509605,
        "sha256": "f2c1cd95861da57dbe4002f3bdf03c91646f46446cca37cb1219fa31e593cb36"
      }
    ],
    "files": [
      {
        "archive": "cpu",
        "entry": "ggml-base.dll",
        "name": "ggml-base.dll",
        "bytes": 803840,
        "sha256": "9cd4bb1b444db281647725306c8fa1ccd9b351c25eb6f949ca6ee697e8fa7454"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-alderlake.dll",
        "name": "ggml-cpu-alderlake.dll",
        "bytes": 1428992,
        "sha256": "09561f20f6edc5d45367701cede0c6eb0c67d276c09104d46761610c9bf7c0f7"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-cannonlake.dll",
        "name": "ggml-cpu-cannonlake.dll",
        "bytes": 1613824,
        "sha256": "e64fd94bdd906ea46ee1d5561e271195391a6e985e7db2b45749773b7dec8480"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-cascadelake.dll",
        "name": "ggml-cpu-cascadelake.dll",
        "bytes": 1597952,
        "sha256": "2a4cc8fd1be96654a6df50ed88bb544a37cd1f6cc881c316552e64c573ee8cb6"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-cooperlake.dll",
        "name": "ggml-cpu-cooperlake.dll",
        "bytes": 1607680,
        "sha256": "80ea2c769e47c28a477cef03eae36c14bf41e4210d735eaaeefa439da609466e"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-haswell.dll",
        "name": "ggml-cpu-haswell.dll",
        "bytes": 1433600,
        "sha256": "d8366a610467831d1b32e7f7efa833cbed1921d409d7e1aa7f420d14add5d01d"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-icelake.dll",
        "name": "ggml-cpu-icelake.dll",
        "bytes": 1604096,
        "sha256": "4ed76df845b03c0c1b64116c3111a1d42ebe8e43a869f08d2da1dc9dc28c00b1"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-ivybridge.dll",
        "name": "ggml-cpu-ivybridge.dll",
        "bytes": 1310208,
        "sha256": "614833f0db18098492e3182980261c9f392944166ef60a4b321cd4953cc716ad"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-piledriver.dll",
        "name": "ggml-cpu-piledriver.dll",
        "bytes": 1304576,
        "sha256": "655fd468aa0b2ea0c3f512aed8e0fbc36e62e8085b44b052a200c6dabb75a6f1"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-sandybridge.dll",
        "name": "ggml-cpu-sandybridge.dll",
        "bytes": 1290240,
        "sha256": "5a81d100dc2551b07ef51134f23df8178d44ef00f0e2270f67246dcfdd4da642"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-sapphirerapids.dll",
        "name": "ggml-cpu-sapphirerapids.dll",
        "bytes": 1892864,
        "sha256": "8a3509bc69ee0051d6353353beda91a4c0078009bfece9ba6198c820a7baa094"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-skylakex.dll",
        "name": "ggml-cpu-skylakex.dll",
        "bytes": 1607168,
        "sha256": "de71a0753ed68776de88564aa3d340f74378fe0f6ab169d5887eb1c7975a6adb"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-sse42.dll",
        "name": "ggml-cpu-sse42.dll",
        "bytes": 915968,
        "sha256": "be29b15feb6523d87031d71e8c3ab7f67acac3517fee0e62506daed4484dd4f6"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-x64.dll",
        "name": "ggml-cpu-x64.dll",
        "bytes": 908800,
        "sha256": "2859fa818f7448481a23132325b3f30b7d69f5e7ba8760ecec22204d2ea55fee"
      },
      {
        "archive": "cpu",
        "entry": "ggml-cpu-zen4.dll",
        "name": "ggml-cpu-zen4.dll",
        "bytes": 1613824,
        "sha256": "adb61cec4c226b49c2c672d3f3c7d42d0c9b834b195a8f27111766374b41de03"
      },
      {
        "archive": "cpu",
        "entry": "ggml-rpc.dll",
        "name": "ggml-rpc.dll",
        "bytes": 215040,
        "sha256": "c43f929576dc95fb11dfb859404e247b52ec18f383a3f32348eee77407d649f9"
      },
      {
        "archive": "cpu",
        "entry": "ggml.dll",
        "name": "ggml.dll",
        "bytes": 79872,
        "sha256": "07208aed4757ee41d18bc014a8b0829b08bc3ecfc75d13d50ad5ab9ee6cb8fae"
      },
      {
        "archive": "cpu",
        "entry": "libomp.dll",
        "name": "libomp.dll",
        "bytes": 768000,
        "sha256": "a12116ba72d1d6820407cf30be23da04ce79d6bb8a71a5ee71759c5a1faa6f1c"
      },
      {
        "archive": "cpu",
        "entry": "LICENSE-LLVM-OpenMP",
        "name": "LICENSE-LLVM-OpenMP",
        "bytes": 19741,
        "sha256": "fdad1758a9e1f9d5a81e18879b3406772115edc92c24bfa36b70c654f325e8e4"
      },
      {
        "archive": "cpu",
        "entry": "llama-batched-bench-impl.dll",
        "name": "llama-batched-bench-impl.dll",
        "bytes": 61952,
        "sha256": "a49317e80351b3c72b949f83d615ad76f6c76ebbdddeefe61320f39f02602f08"
      },
      {
        "archive": "cpu",
        "entry": "llama-bench-impl.dll",
        "name": "llama-bench-impl.dll",
        "bytes": 404480,
        "sha256": "34e6221bdfaac86507e20fb88ad92c10ae7871c82b2615ef44c5be3edfb03562"
      },
      {
        "archive": "cpu",
        "entry": "llama-cli-impl.dll",
        "name": "llama-cli-impl.dll",
        "bytes": 3317248,
        "sha256": "89ac62bc224717e09f554efa7ff27e98819004655de167aa0932a10e91af7b44"
      },
      {
        "archive": "cpu",
        "entry": "llama-common.dll",
        "name": "llama-common.dll",
        "bytes": 8004096,
        "sha256": "6b29d93d185f10881150c5cd1ce5f4fe381387c90d0b81e1e89be7934cc2f5e7"
      },
      {
        "archive": "cpu",
        "entry": "llama-completion-impl.dll",
        "name": "llama-completion-impl.dll",
        "bytes": 140288,
        "sha256": "a8cb8bbbfb2c43155b9dd3c6eb7b026f35f23ef9fe21d159f1b535b111a8ef21"
      },
      {
        "archive": "cpu",
        "entry": "llama-fit-params-impl.dll",
        "name": "llama-fit-params-impl.dll",
        "bytes": 43008,
        "sha256": "98e070d44d3e49ac372b97719f9a942d4fa984cc008fdcfc9553cdb0a8d70ce9"
      },
      {
        "archive": "cpu",
        "entry": "llama-perplexity-impl.dll",
        "name": "llama-perplexity-impl.dll",
        "bytes": 197632,
        "sha256": "1d37669003a5847e663355d9937cfb3f36a942e249eaeb1fa8d34ae58308fd66"
      },
      {
        "archive": "cpu",
        "entry": "llama-quantize-impl.dll",
        "name": "llama-quantize-impl.dll",
        "bytes": 137216,
        "sha256": "6a6879ab6c319b66f26500c38f6711520eeff7aeb4d3b769ae557e9e5512b928"
      },
      {
        "archive": "cpu",
        "entry": "llama-server-impl.dll",
        "name": "llama-server-impl.dll",
        "bytes": 9245696,
        "sha256": "25b54504f79a07b3dcf7ab7a274a9351c1e2a7eaf71da4e8df593c0e7a5056da"
      },
      {
        "archive": "cpu",
        "entry": "llama-server.exe",
        "name": "llama-server.exe",
        "bytes": 9216,
        "sha256": "f68a84da91f5de88ce1de45a1aedf45ce7b8321041c65b72dfa4523ddb989298"
      },
      {
        "archive": "cpu",
        "entry": "llama.dll",
        "name": "llama.dll",
        "bytes": 3436032,
        "sha256": "78191c4f23bba9d943dc577373f6202cebe9b54d28cacfa6f8e772fdf51b79bd"
      },
      {
        "archive": "cpu",
        "entry": "mtmd.dll",
        "name": "mtmd.dll",
        "bytes": 1835008,
        "sha256": "2db458e31c308517ebd13990d4fb6c437f1a18c8f955fc2ec1191d200d570463"
      }
    ]
  },
  {
    "id": "llama-b11588-cuda-x64",
    "backend": "cuda",
    "revision": "b11588",
    "archives": [
      {
        "id": "cuda",
        "name": "llama-b11588-bin-win-cuda-12.4-x64.zip",
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b11588/llama-b11588-bin-win-cuda-12.4-x64.zip",
        "bytes": 265217350,
        "sha256": "b332d03139fbb8453c1ee7dd89321f10186aedaa35b9a2e326f6569e7dcaa04f"
      },
      {
        "id": "cuda-dependencies",
        "name": "cudart-llama-bin-win-cuda-12.4-x64.zip",
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b11588/cudart-llama-bin-win-cuda-12.4-x64.zip",
        "bytes": 391443627,
        "sha256": "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6"
      }
    ],
    "files": [
      {
        "archive": "cuda",
        "entry": "ggml-cuda.dll",
        "name": "ggml-cuda.dll",
        "bytes": 572299264,
        "sha256": "bced87e4ce1ed54830f07e49265390b86a70a166d3099feaba48fcd1d2d2abd3"
      },
      {
        "archive": "cuda",
        "entry": "ggml-base.dll",
        "name": "ggml-base.dll",
        "bytes": 803840,
        "sha256": "9cd4bb1b444db281647725306c8fa1ccd9b351c25eb6f949ca6ee697e8fa7454"
      },
      {
        "archive": "cuda",
        "entry": "LICENSE-LLVM-OpenMP",
        "name": "LICENSE-LLVM-OpenMP",
        "bytes": 19741,
        "sha256": "fdad1758a9e1f9d5a81e18879b3406772115edc92c24bfa36b70c654f325e8e4"
      },
      {
        "archive": "cuda",
        "entry": "llama-batched-bench-impl.dll",
        "name": "llama-batched-bench-impl.dll",
        "bytes": 61952,
        "sha256": "a49317e80351b3c72b949f83d615ad76f6c76ebbdddeefe61320f39f02602f08"
      },
      {
        "archive": "cuda",
        "entry": "mtmd.dll",
        "name": "mtmd.dll",
        "bytes": 1835008,
        "sha256": "2db458e31c308517ebd13990d4fb6c437f1a18c8f955fc2ec1191d200d570463"
      },
      {
        "archive": "cuda",
        "entry": "llama-completion-impl.dll",
        "name": "llama-completion-impl.dll",
        "bytes": 140288,
        "sha256": "a8cb8bbbfb2c43155b9dd3c6eb7b026f35f23ef9fe21d159f1b535b111a8ef21"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-sapphirerapids.dll",
        "name": "ggml-cpu-sapphirerapids.dll",
        "bytes": 1892864,
        "sha256": "8a3509bc69ee0051d6353353beda91a4c0078009bfece9ba6198c820a7baa094"
      },
      {
        "archive": "cuda",
        "entry": "ggml-rpc.dll",
        "name": "ggml-rpc.dll",
        "bytes": 215040,
        "sha256": "c43f929576dc95fb11dfb859404e247b52ec18f383a3f32348eee77407d649f9"
      },
      {
        "archive": "cuda",
        "entry": "llama-cli-impl.dll",
        "name": "llama-cli-impl.dll",
        "bytes": 3317248,
        "sha256": "89ac62bc224717e09f554efa7ff27e98819004655de167aa0932a10e91af7b44"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-piledriver.dll",
        "name": "ggml-cpu-piledriver.dll",
        "bytes": 1304576,
        "sha256": "655fd468aa0b2ea0c3f512aed8e0fbc36e62e8085b44b052a200c6dabb75a6f1"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-cannonlake.dll",
        "name": "ggml-cpu-cannonlake.dll",
        "bytes": 1613824,
        "sha256": "e64fd94bdd906ea46ee1d5561e271195391a6e985e7db2b45749773b7dec8480"
      },
      {
        "archive": "cuda",
        "entry": "llama-perplexity-impl.dll",
        "name": "llama-perplexity-impl.dll",
        "bytes": 197632,
        "sha256": "1d37669003a5847e663355d9937cfb3f36a942e249eaeb1fa8d34ae58308fd66"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-skylakex.dll",
        "name": "ggml-cpu-skylakex.dll",
        "bytes": 1607168,
        "sha256": "de71a0753ed68776de88564aa3d340f74378fe0f6ab169d5887eb1c7975a6adb"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-sse42.dll",
        "name": "ggml-cpu-sse42.dll",
        "bytes": 915968,
        "sha256": "be29b15feb6523d87031d71e8c3ab7f67acac3517fee0e62506daed4484dd4f6"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-haswell.dll",
        "name": "ggml-cpu-haswell.dll",
        "bytes": 1433600,
        "sha256": "d8366a610467831d1b32e7f7efa833cbed1921d409d7e1aa7f420d14add5d01d"
      },
      {
        "archive": "cuda",
        "entry": "llama-common.dll",
        "name": "llama-common.dll",
        "bytes": 8004096,
        "sha256": "6b29d93d185f10881150c5cd1ce5f4fe381387c90d0b81e1e89be7934cc2f5e7"
      },
      {
        "archive": "cuda",
        "entry": "libomp.dll",
        "name": "libomp.dll",
        "bytes": 768000,
        "sha256": "a12116ba72d1d6820407cf30be23da04ce79d6bb8a71a5ee71759c5a1faa6f1c"
      },
      {
        "archive": "cuda",
        "entry": "llama-server-impl.dll",
        "name": "llama-server-impl.dll",
        "bytes": 9245696,
        "sha256": "25b54504f79a07b3dcf7ab7a274a9351c1e2a7eaf71da4e8df593c0e7a5056da"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-alderlake.dll",
        "name": "ggml-cpu-alderlake.dll",
        "bytes": 1428992,
        "sha256": "09561f20f6edc5d45367701cede0c6eb0c67d276c09104d46761610c9bf7c0f7"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-sandybridge.dll",
        "name": "ggml-cpu-sandybridge.dll",
        "bytes": 1290240,
        "sha256": "5a81d100dc2551b07ef51134f23df8178d44ef00f0e2270f67246dcfdd4da642"
      },
      {
        "archive": "cuda",
        "entry": "ggml.dll",
        "name": "ggml.dll",
        "bytes": 79872,
        "sha256": "07208aed4757ee41d18bc014a8b0829b08bc3ecfc75d13d50ad5ab9ee6cb8fae"
      },
      {
        "archive": "cuda",
        "entry": "llama-quantize-impl.dll",
        "name": "llama-quantize-impl.dll",
        "bytes": 137216,
        "sha256": "6a6879ab6c319b66f26500c38f6711520eeff7aeb4d3b769ae557e9e5512b928"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-zen4.dll",
        "name": "ggml-cpu-zen4.dll",
        "bytes": 1613824,
        "sha256": "adb61cec4c226b49c2c672d3f3c7d42d0c9b834b195a8f27111766374b41de03"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-cascadelake.dll",
        "name": "ggml-cpu-cascadelake.dll",
        "bytes": 1597952,
        "sha256": "2a4cc8fd1be96654a6df50ed88bb544a37cd1f6cc881c316552e64c573ee8cb6"
      },
      {
        "archive": "cuda",
        "entry": "llama-bench-impl.dll",
        "name": "llama-bench-impl.dll",
        "bytes": 404480,
        "sha256": "34e6221bdfaac86507e20fb88ad92c10ae7871c82b2615ef44c5be3edfb03562"
      },
      {
        "archive": "cuda",
        "entry": "llama.dll",
        "name": "llama.dll",
        "bytes": 3436032,
        "sha256": "78191c4f23bba9d943dc577373f6202cebe9b54d28cacfa6f8e772fdf51b79bd"
      },
      {
        "archive": "cuda",
        "entry": "llama-server.exe",
        "name": "llama-server.exe",
        "bytes": 9216,
        "sha256": "f68a84da91f5de88ce1de45a1aedf45ce7b8321041c65b72dfa4523ddb989298"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-x64.dll",
        "name": "ggml-cpu-x64.dll",
        "bytes": 908800,
        "sha256": "2859fa818f7448481a23132325b3f30b7d69f5e7ba8760ecec22204d2ea55fee"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-cooperlake.dll",
        "name": "ggml-cpu-cooperlake.dll",
        "bytes": 1607680,
        "sha256": "80ea2c769e47c28a477cef03eae36c14bf41e4210d735eaaeefa439da609466e"
      },
      {
        "archive": "cuda",
        "entry": "llama-fit-params-impl.dll",
        "name": "llama-fit-params-impl.dll",
        "bytes": 43008,
        "sha256": "98e070d44d3e49ac372b97719f9a942d4fa984cc008fdcfc9553cdb0a8d70ce9"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-ivybridge.dll",
        "name": "ggml-cpu-ivybridge.dll",
        "bytes": 1310208,
        "sha256": "614833f0db18098492e3182980261c9f392944166ef60a4b321cd4953cc716ad"
      },
      {
        "archive": "cuda",
        "entry": "ggml-cpu-icelake.dll",
        "name": "ggml-cpu-icelake.dll",
        "bytes": 1604096,
        "sha256": "4ed76df845b03c0c1b64116c3111a1d42ebe8e43a869f08d2da1dc9dc28c00b1"
      },
      {
        "archive": "cuda-dependencies",
        "entry": "cublas64_12.dll",
        "name": "cublas64_12.dll",
        "bytes": 100033536,
        "sha256": "e40202fe4223c1cd2d2dce7beec59e1ed61c7801bd827309183be9b50e358f4c"
      },
      {
        "archive": "cuda-dependencies",
        "entry": "cublasLt64_12.dll",
        "name": "cublasLt64_12.dll",
        "bytes": 473551360,
        "sha256": "2a896460bef60ed57ef32b0875812f355a6984e671d638bb632f5e8c1d7a831f"
      },
      {
        "archive": "cuda-dependencies",
        "entry": "cudart64_12.dll",
        "name": "cudart64_12.dll",
        "bytes": 553984,
        "sha256": "d28e42265da7462162a54da6b7a99ea4fa2caf8139d862bb500db875d0b32dfc"
      }
    ]
  }
];
