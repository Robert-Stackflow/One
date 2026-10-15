import type {FormulaRuntimeProfile} from './formula-runtime-catalog';
/** Optional CPU conversion package. Headers, static link libraries and ONNX test data are excluded. */
export const formulaTorchRuntimeProfile:FormulaRuntimeProfile={
  "id": "formula-torch-builder-win-x64",
  "revision": "py3127-t251-p014-min-v1",
  "manifestSha256": "d5c1093f558acdb4419e39d60b223022585a8a18d2a0ddb77224a1d1539ff06a",
  "expandedBytes": 475358246,
  "files": 7101,
  "selection": {
    "maxArchiveBytes": 2147483648,
    "excludePrefixes": [
      "torch/include/",
      "onnx/backend/test/data/"
    ],
    "excludeSuffixes": [
      ".lib"
    ]
  },
  "artifacts": [
    {
      "name": "python-3.12.7-embed-amd64.zip",
      "role": "python",
      "url": "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip",
      "bytes": 11062583,
      "sha256": "0d57bb6cb078b74d23dbfe91f77d6780d45bed328911609f1f7ee2ba1606bf44"
    },
    {
      "name": "torch-2.5.1+cpu-cp312-cp312-win_amd64.whl",
      "role": "torch",
      "url": "https://download-r2.pytorch.org/whl/cpu/torch-2.5.1%2Bcpu-cp312-cp312-win_amd64.whl",
      "bytes": 205405035,
      "sha256": "a6b720410350765d3d77c01a5ce098a6c45af446284e45e87a98b8a16e7d564d"
    },
    {
      "name": "torchvision-0.20.1+cpu-cp312-cp312-win_amd64.whl",
      "role": "torchvision",
      "url": "https://download-r2.pytorch.org/whl/cpu/torchvision-0.20.1%2Bcpu-cp312-cp312-win_amd64.whl",
      "bytes": 1556388,
      "sha256": "64832095b9b8b8185f24788f1a531ae96c937bf797cd3474a2ea7511852e5cd7"
    },
    {
      "name": "timm-0.5.4-py3-none-any.whl",
      "role": "timm",
      "url": "https://files.pythonhosted.org/packages/49/65/a83208746dc9c0d70feff7874b49780ff110810feb528df4b0ecadcbee60/timm-0.5.4-py3-none-any.whl",
      "bytes": 431537,
      "sha256": "0592c8fd2d46d0769c0b7e954b3dacea93769eee40dabb4bd7f2acb85243b588"
    },
    {
      "name": "x_transformers-0.15.0-py3-none-any.whl",
      "role": "x-transformers",
      "url": "https://files.pythonhosted.org/packages/be/52/62fd9d73f4c3f56442c590bc020f25597df5ba37db789f7861922b991e5c/x_transformers-0.15.0-py3-none-any.whl",
      "bytes": 11208,
      "sha256": "7feefcf32f46005c2b9141d7dc0b08a0a472e4a7f4ea1f95e9e8dd4e79227309"
    },
    {
      "name": "entmax-1.3-py3-none-any.whl",
      "role": "entmax",
      "url": "https://files.pythonhosted.org/packages/06/a0/71747f0d98e441d0670b06205afd24d832e88c0ee62129ca47ce88505304/entmax-1.3-py3-none-any.whl",
      "bytes": 13359,
      "sha256": "41bb1edbd497a1b53b1f0fc80befd543499dc704b4e5436ddf6c5728a2d00546"
    },
    {
      "name": "einops-0.8.2-py3-none-any.whl",
      "role": "einops",
      "url": "https://files.pythonhosted.org/packages/2a/09/f8d8f8f31e4483c10a906437b4ce31bdf3d6d417b73fe33f1a8b59e34228/einops-0.8.2-py3-none-any.whl",
      "bytes": 65638,
      "sha256": "54058201ac7087911181bfec4af6091bb59380360f069276601256a76af08193"
    },
    {
      "name": "munch-4.0.0-py2.py3-none-any.whl",
      "role": "munch",
      "url": "https://files.pythonhosted.org/packages/56/b3/7c69b37f03260a061883bec0e7b05be7117c1b1c85f5212c72c8c2bc3c8c/munch-4.0.0-py2.py3-none-any.whl",
      "bytes": 9950,
      "sha256": "71033c45db9fb677a0b7eb517a4ce70ae09258490e419b0e7f00d1e386ecb1b4"
    },
    {
      "name": "pyyaml-6.0.3-cp312-cp312-win_amd64.whl",
      "role": "pyyaml",
      "url": "https://files.pythonhosted.org/packages/86/bf/899e81e4cce32febab4fb42bb97dcdf66bc135272882d1987881a4b519e9/pyyaml-6.0.3-cp312-cp312-win_amd64.whl",
      "bytes": 154003,
      "sha256": "5fcd34e47f6e0b794d17de1b4ff496c00986e1c83f7ab2fb8fcfe9616ff7477b"
    },
    {
      "name": "onnx-1.17.0-cp312-cp312-win_amd64.whl",
      "role": "onnx",
      "url": "https://files.pythonhosted.org/packages/35/55/c4d11bee1fdb0c4bd84b4e3562ff811a19b63266816870ae1f95567aa6e1/onnx-1.17.0-cp312-cp312-win_amd64.whl",
      "bytes": 14530453,
      "sha256": "659b8232d627a5460d74fd3c96947ae83db6d03f035ac633e20cd69cfa029227"
    },
    {
      "name": "numpy-1.26.4-cp312-cp312-win_amd64.whl",
      "role": "numpy",
      "url": "https://files.pythonhosted.org/packages/16/2e/86f24451c2d530c88daf997cb8d6ac622c1d40d19f5a031ed68a4b73a374/numpy-1.26.4-cp312-cp312-win_amd64.whl",
      "bytes": 15517754,
      "sha256": "08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818"
    },
    {
      "name": "pillow-12.3.0-cp312-cp312-win_amd64.whl",
      "role": "pillow",
      "url": "https://files.pythonhosted.org/packages/45/89/da2f7971a317f83d807fdd4065c0af40208e59e692cc43d315a71a0e96d1/pillow-12.3.0-cp312-cp312-win_amd64.whl",
      "bytes": 7227137,
      "sha256": "a2b55dd6b2a4c4b7d87ffa56bdb33fdc5fdb9a462173861a7bc097f17d91cb09"
    },
    {
      "name": "filelock-4.2.0-py3-none-any.whl",
      "role": "filelock",
      "url": "https://files.pythonhosted.org/packages/8e/a3/9bc26acff301fe1aaea1cc3d82a1d57e0a34df3e1cadbfa91ac2dbcdde5c/filelock-4.2.0-py3-none-any.whl",
      "bytes": 135032,
      "sha256": "2ff5690882e8cdb00ef31fb3d01a3094c29f30985426c59495afb1733f3b7238"
    },
    {
      "name": "typing_extensions-4.16.0-py3-none-any.whl",
      "role": "typing-extensions",
      "url": "https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl",
      "bytes": 45571,
      "sha256": "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8"
    },
    {
      "name": "networkx-3.7-py3-none-any.whl",
      "role": "networkx",
      "url": "https://files.pythonhosted.org/packages/7e/cd/fe58041e9011f307c490e3e17dd48cc516448f7c698a3f2d9d9d65d7e6a8/networkx-3.7-py3-none-any.whl",
      "bytes": 2142205,
      "sha256": "e3fd2c13a7814cee3746340d8d7f8598a67f16a58bf47fb7f8793fab6efca1b0"
    },
    {
      "name": "jinja2-3.1.6-py3-none-any.whl",
      "role": "jinja2",
      "url": "https://files.pythonhosted.org/packages/62/a1/3d680cbfd5f4b8f15abc1d571870c5fc3e594bb582bc3b64ea099db13e56/jinja2-3.1.6-py3-none-any.whl",
      "bytes": 134899,
      "sha256": "85ece4451f492d0c13c5dd7c13a64681a86afae63a5f347908daf103ce6d2f67"
    },
    {
      "name": "fsspec-2026.9.0-py3-none-any.whl",
      "role": "fsspec",
      "url": "https://files.pythonhosted.org/packages/6c/c0/a98505f18594f1bce828bb159cec0fcf9860562f1a2c85913409fc8f3d9e/fsspec-2026.9.0-py3-none-any.whl",
      "bytes": 221738,
      "sha256": "8dd6e646e99ea382bd85f97a45e6b526a442d79423a7dc673f1e2756d05fcb5f"
    },
    {
      "name": "sympy-1.13.1-py3-none-any.whl",
      "role": "sympy",
      "url": "https://files.pythonhosted.org/packages/b2/fe/81695a1aa331a842b582453b605175f419fe8540355886031328089d840a/sympy-1.13.1-py3-none-any.whl",
      "bytes": 6189177,
      "sha256": "db36cdc64bf61b9b24578b6f7bab1ecdd2452cf008f34faa33776680c26d66f8"
    },
    {
      "name": "setuptools-84.0.0-py3-none-any.whl",
      "role": "setuptools",
      "url": "https://files.pythonhosted.org/packages/95/9c/c510029fc6ef33a6275cd2c5d3cecd6613dfd6aa401d57c54f1c18852ccf/setuptools-84.0.0-py3-none-any.whl",
      "bytes": 818216,
      "sha256": "51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670"
    },
    {
      "name": "mpmath-1.3.0-py3-none-any.whl",
      "role": "mpmath",
      "url": "https://files.pythonhosted.org/packages/43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209/mpmath-1.3.0-py3-none-any.whl",
      "bytes": 536198,
      "sha256": "a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c"
    },
    {
      "name": "markupsafe-3.0.4-cp312-cp312-win_amd64.whl",
      "role": "markupsafe",
      "url": "https://files.pythonhosted.org/packages/3f/bf/62495e180b7000aaf30000fff849e933f74264638057176cf46852500adc/markupsafe-3.0.4-cp312-cp312-win_amd64.whl",
      "bytes": 14303,
      "sha256": "11935df9bf455ed0c04eb87bcd720f02b1fe5e02128a9430f23aed6f93336fc7"
    },
    {
      "name": "protobuf-7.36.2-cp310-abi3-win_amd64.whl",
      "role": "protobuf",
      "url": "https://files.pythonhosted.org/packages/8a/55/b77bda4e5e5f5971fb51b07663694690e9afdb9402136c16a522bd621cad/protobuf-7.36.2-cp310-abi3-win_amd64.whl",
      "bytes": 456514,
      "sha256": "a300819d441e078a5608c0d3c709796bb548136058fda017ae51d425b44fd353"
    },
    {
      "name": "pix2tex-0.1.4-py3-none-any.whl",
      "role": "pix2tex",
      "url": "https://files.pythonhosted.org/packages/12/b8/673667ace0a131169502420810aa9dfca69aad960d5af88da68ddd46c7f0/pix2tex-0.1.4-py3-none-any.whl",
      "bytes": 427031,
      "sha256": "a024309508fc3e8a4ce5241e095276626d098df53e609410013f2ec35a4b7612"
    }
  ]
};
