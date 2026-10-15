import type {LocalArtifactBundle} from '../../shared/local-models';
import type {RuntimeSelection} from './formula-runtime-tree';
export interface FormulaRuntimeProfile extends LocalArtifactBundle {manifestSha256:string;expandedBytes:number;files:number;selection?:RuntimeSelection}
export const formulaRuntimeProfile:FormulaRuntimeProfile = {
  "id": "formula-builder-win-x64",
  "revision": "py3127-p311-p2o210-v1",
  "manifestSha256": "508ca25b01e805ffb403a9ff2c24e852ff2bd84a7267e5d4c2f8a1c19d2dd569",
  "expandedBytes": 523466571,
  "files": 12151,
  "artifacts": [
    {
      "name": "python-3.12.7-embed-amd64.zip",
      "role": "python",
      "url": "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip",
      "bytes": 11062583,
      "sha256": "0d57bb6cb078b74d23dbfe91f77d6780d45bed328911609f1f7ee2ba1606bf44"
    },
    {
      "name": "anyio-4.15.1-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/12/b8/4bd346e22b28902df4d651910f5242c28d84e4a5c2435ca5c3f797ed7e2e/anyio-4.15.1-py3-none-any.whl",
      "bytes": 132079,
      "sha256": "6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
      "role": "anyio"
    },
    {
      "name": "certifi-2026.7.22-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl",
      "bytes": 136983,
      "sha256": "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775",
      "role": "certifi"
    },
    {
      "name": "h11-0.16.0-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/04/4b/29cac41a4d98d144bf5f6d33995617b185d14b22401f75ca86f384e87ff1/h11-0.16.0-py3-none-any.whl",
      "bytes": 37515,
      "sha256": "63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
      "role": "h11"
    },
    {
      "name": "httpcore-1.0.9-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/7e/f5/f66802a942d491edb555dd61e3a9961140fd64c90bce1eafd741609d334d/httpcore-1.0.9-py3-none-any.whl",
      "bytes": 78784,
      "sha256": "2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55",
      "role": "httpcore"
    },
    {
      "name": "httpx-0.28.1-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/2a/39/e50c7c3a983047577ee07d2a9e53faf5a69493943ec3f6a384bdc792deb2/httpx-0.28.1-py3-none-any.whl",
      "bytes": 73517,
      "sha256": "d909fcccc110f8c7faf814ca82a9a4d816bc5a6dbfea25d6591d6985b8ba59ad",
      "role": "httpx"
    },
    {
      "name": "idna-3.20-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl",
      "bytes": 69583,
      "sha256": "ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c",
      "role": "idna"
    },
    {
      "name": "networkx-3.7-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/7e/cd/fe58041e9011f307c490e3e17dd48cc516448f7c698a3f2d9d9d65d7e6a8/networkx-3.7-py3-none-any.whl",
      "bytes": 2142205,
      "sha256": "e3fd2c13a7814cee3746340d8d7f8598a67f16a58bf47fb7f8793fab6efca1b0",
      "role": "networkx"
    },
    {
      "name": "numpy-1.26.4-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/16/2e/86f24451c2d530c88daf997cb8d6ac622c1d40d19f5a031ed68a4b73a374/numpy-1.26.4-cp312-cp312-win_amd64.whl",
      "bytes": 15517754,
      "sha256": "08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818",
      "role": "numpy"
    },
    {
      "name": "onnx-1.17.0-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/35/55/c4d11bee1fdb0c4bd84b4e3562ff811a19b63266816870ae1f95567aa6e1/onnx-1.17.0-cp312-cp312-win_amd64.whl",
      "bytes": 14530453,
      "sha256": "659b8232d627a5460d74fd3c96947ae83db6d03f035ac633e20cd69cfa029227",
      "role": "onnx"
    },
    {
      "name": "opt_einsum-3.3.0-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/bc/19/404708a7e54ad2798907210462fd950c3442ea51acc8790f3da48d2bee8b/opt_einsum-3.3.0-py3-none-any.whl",
      "bytes": 65486,
      "sha256": "2455e59e3947d3c275477df7f5205b30635e266fe6dc300e3d9f9646bfcea147",
      "role": "opt-einsum"
    },
    {
      "name": "packaging-26.3-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl",
      "bytes": 129956,
      "sha256": "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
      "role": "packaging"
    },
    {
      "name": "paddle2onnx-2.1.0-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/9f/b1/b7a4b875cd61063dd5945fde212925493042a7e9f2a9346afa401e3d1510/paddle2onnx-2.1.0-cp312-cp312-win_amd64.whl",
      "bytes": 2028293,
      "sha256": "55fe0b6eba1227b3a9b362a0881f60a3fedb4c6251c3de7d42f0113ab26bbbf9",
      "role": "paddle2onnx"
    },
    {
      "name": "paddlepaddle-3.1.1-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/83/11/85c8d6de625f7d3b7d56055b4e9dd8ae0f428049ef3cd3a4fe35a3107c37/paddlepaddle-3.1.1-cp312-cp312-win_amd64.whl",
      "bytes": 100398619,
      "sha256": "992d31c9e5298f524d1340c7a85db97def72f900ce3030ae6cd3bd4396a4622f",
      "role": "paddlepaddle"
    },
    {
      "name": "pillow-12.3.0-cp312-cp312-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/45/89/da2f7971a317f83d807fdd4065c0af40208e59e692cc43d315a71a0e96d1/pillow-12.3.0-cp312-cp312-win_amd64.whl",
      "bytes": 7227137,
      "sha256": "a2b55dd6b2a4c4b7d87ffa56bdb33fdc5fdb9a462173861a7bc097f17d91cb09",
      "role": "pillow"
    },
    {
      "name": "polygraphy-0.53.6-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/8b/16/a3069a489c36e855d3a792a532a96e6434e1a454a21248effd3a26da2a7b/polygraphy-0.53.6-py3-none-any.whl",
      "bytes": 485433,
      "sha256": "539095f64054823aabac5d4c8d64875b5a1542b71ca76443e218a01fdc1a4e03",
      "role": "polygraphy"
    },
    {
      "name": "protobuf-7.36.2-cp310-abi3-win_amd64.whl",
      "url": "https://files.pythonhosted.org/packages/8a/55/b77bda4e5e5f5971fb51b07663694690e9afdb9402136c16a522bd621cad/protobuf-7.36.2-cp310-abi3-win_amd64.whl",
      "bytes": 456514,
      "sha256": "a300819d441e078a5608c0d3c709796bb548136058fda017ae51d425b44fd353",
      "role": "protobuf"
    },
    {
      "name": "setuptools-84.0.0-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/95/9c/c510029fc6ef33a6275cd2c5d3cecd6613dfd6aa401d57c54f1c18852ccf/setuptools-84.0.0-py3-none-any.whl",
      "bytes": 818216,
      "sha256": "51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670",
      "role": "setuptools"
    },
    {
      "name": "typing_extensions-4.16.0-py3-none-any.whl",
      "url": "https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl",
      "bytes": 45571,
      "sha256": "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
      "role": "typing-extensions"
    }
  ]
};
