"""Offline CPU feasibility probe; does not register an application model.

Preprocessing follows PaddleX formula_recognition/processors.py (Apache-2.0).
Use the isolated environment and immutable Hub revision recorded in the report.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import psutil
import yaml
from PIL import Image, ImageOps
from tokenizers import Tokenizer

PRESETS = {
    "PP-FormulaNet-S": (
        "0572450e501be9eb1b1cdb7e00fccf4b22fab4df",
        231675001,
        "b6392296d16e2a9f414c0a751d7ccbd1bd9d8272b68aab72df1d3875f35a7489",
    ),
    "PP-FormulaNet_plus-S": (
        "3d46f557e3a1752f4bf81202395af3b5ecfadfd2",
        256845006,
        "e464f94412feaa98f8791eacc84684f887b3569e30e80c52b8112e9cf7d4069b",
    ),
    "PP-FormulaNet_plus-M": (
        "712e6e2e4c313b1ea163be5c350127b82662c58d",
        617064962,
        "f16ef9b5c8227da70d3ec969a5195f4d62c1154427b883f4d6cff07633654041",
    ),
    "PP-FormulaNet-L": (
        "9994c2af5c2070b239f1fd2ecc2b40fbf378ea1d",
        724452527,
        "039b320b0d1b64361a053f7496b05db9f53fabd22d27c80ccfab4c59d3881318",
    ),
    "PP-FormulaNet_plus-L": (
        "0809597a77f735bfb35354edb632f2e6dff606f3",
        727598255,
        "4245c39c181d1d21e472bc85c7434df9b23f177be46552c0542bf153addbc355",
    ),
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def preprocess(path, shape):
    image = Image.open(path).convert("RGB")
    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    low, high = int(gray.min()), int(gray.max())
    if high != low:
        ys, xs = np.where((gray.astype(np.float64) - low) / (high - low) * 255 < 200)
        image = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    height, width = shape
    short = min(shape)
    resized = (short, int(short * image.height / image.width)) if image.width <= image.height else (int(short * image.width / image.height), short)
    image = image.resize(resized, Image.Resampling.BILINEAR)
    image.thumbnail((width, height))
    dx, dy = width - image.width, height - image.height
    image = ImageOps.expand(image, (dx // 2, dy // 2, dx - dx // 2, dy - dy // 2))
    rgb = (np.asarray(image, dtype=np.float32) / 255 - np.float32(.7931)) / np.float32(.1738)
    # Official preprocessing calls BGR2GRAY on its decoded RGB array.
    gray = rgb[:, :, 0] * np.float32(.114) + rgb[:, :, 1] * np.float32(.587) + rgb[:, :, 2] * np.float32(.299)
    # LatexImageFormat keeps one channel; the exported graph expands to RGB.
    return np.ascontiguousarray(gray[None, None], dtype=np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--onnx", type=Path)
    args = parser.parse_args()
    yaml_file = args.model_root / "inference.yml"
    config = yaml.safe_load(yaml_file.read_text(encoding="utf8")) if yaml_file.exists() else json.loads((args.model_root / "config.json").read_text(encoding="utf8"))
    name = config["Global"]["model_name"]
    revision, size, sha = PRESETS[name]
    max_tokens = next(op["UniMERNetLabelEncode"]["max_seq_len"] for op in config["PreProcess"]["transform_ops"] if "UniMERNetLabelEncode" in op)
    if max_tokens not in [1024, 2560]:
        raise ValueError("Unexpected model sequence limit")
    weights = args.model_root / "inference.pdiparams"
    if weights.stat().st_size != size or digest(weights) != sha:
        raise ValueError("Official model weights failed size/SHA-256 validation")
    shape = next(op["UniMERNetImgDecode"]["input_size"] for op in config["PreProcess"]["transform_ops"] if "UniMERNetImgDecode" in op)
    pixels = preprocess(args.image, shape)
    tokenizer = Tokenizer.from_str(json.dumps(config["PostProcess"]["character_dict"]["fast_tokenizer_file"]))
    start = time.perf_counter()
    if args.onnx:
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.log_severity_level = 3
        session = ort.InferenceSession(str(args.onnx), options, providers=["CPUExecutionProvider"])
        inputs = [{"name": item.name, "shape": item.shape, "type": item.type} for item in session.get_inputs()]
        outputs = [item.name for item in session.get_outputs()]
        run = lambda: session.run(None, {inputs[0]["name"]: pixels})[0]
        runtime = {"backend": "onnx-cpu", "version": ort.__version__, "modelSha256": digest(args.onnx)}
    else:
        import paddle
        settings = paddle.inference.Config(str(args.model_root / "inference.json"), str(weights))
        settings.disable_gpu()
        settings.set_cpu_math_library_num_threads(2)
        settings.disable_mkldnn()
        settings.disable_glog_info()
        predictor = paddle.inference.create_predictor(settings)
        names = predictor.get_input_names()
        if len(names) != 1:
            raise ValueError("Probe requires the official single-image input contract")
        handle = predictor.get_input_handle(names[0])
        handle.reshape(pixels.shape)
        handle.copy_from_cpu(pixels)
        outputs = predictor.get_output_names()
        inputs = [{"name": names[0], "shape": list(pixels.shape), "type": "float32"}]

        def run():
            predictor.run()
            return predictor.get_output_handle(outputs[0]).copy_to_cpu()

        runtime = {"backend": "paddle-cpu", "version": paddle.__version__}
    loaded_ms = round((time.perf_counter() - start) * 1000)
    results = []
    process = psutil.Process()
    for index in range(2):
        start = time.perf_counter()
        tokens = np.asarray(run()).reshape(-1)
        elapsed = round((time.perf_counter() - start) * 1000)
        if not np.issubdtype(tokens.dtype, np.integer) or len(tokens) > max_tokens:
            raise ValueError("Unexpected output token contract")
        eos = np.flatnonzero(tokens == 2)
        visible = tokens[: int(eos[0]) + 1] if len(eos) else tokens
        text = tokenizer.decode(visible.tolist(), skip_special_tokens=True)
        if not text.strip():
            raise ValueError("Model returned empty LaTeX")
        memory = process.memory_info()
        results.append({"iteration": index, "inferenceMs": elapsed, "tokens": len(tokens), "latex": text,
                        "tokenSha256": hashlib.sha256(tokens.astype("<i8").tobytes()).hexdigest(),
                        "rssMiB": round(memory.rss / 1048576), "peakRssMiB": round(getattr(memory, "peak_wset", memory.rss) / 1048576)})
    report = {"model": name, "revision": revision, "weightsSha256": sha, "maxTokens": max_tokens, "runtime": runtime,
              "inputSha256": digest(args.image), "inputShape": list(pixels.shape), "inputs": inputs,
              "outputs": outputs, "loadMs": loaded_ms, "results": results}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps({"model": name, "backend": runtime["backend"], "loadMs": loaded_ms,
                      "results": [{**row, "latex": row["latex"][:240]} for row in results]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
