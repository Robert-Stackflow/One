"""Offline Windows pix2tex feasibility probe, using the official 0.1.4 pipeline.

Run with formula-bounded.cjs in an isolated environment. This does not register
an application model or download resources. The official CLI's clipboard write
is intercepted; checkpoints are loaded with weights_only=True.
"""
import argparse
import hashlib
import importlib.metadata
import json
import socket
import time
from pathlib import Path


ARTIFACTS = {
    "weights.pth": (102113875, "a63d9141c53d266cb682fb5a8bd83bd5cbe283145e0e78ebdc0f895195a1dfaa"),
    "image_resizer.pth": (19441973, "1c3820659985ad142b526490bb25c23d977176ac2073591b3bddada692718458"),
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--pipeline", choices=["reference", "core"], default="reference")
    parser.add_argument("--greedy", action="store_true")
    args = parser.parse_args()
    root, cases, report = args.model_root.resolve(), args.cases.resolve(), args.report.resolve()
    started = time.monotonic()
    for name, (size, sha256) in ARTIFACTS.items():
        path = root / name
        if path.stat().st_size != size or digest(path) != sha256:
            raise ValueError("Checkpoint does not match the fixed official release: " + name)
    if importlib.metadata.version("pix2tex") != "0.1.4":
        raise ValueError("Expected official pix2tex 0.1.4")

    network_attempts, clipboard_attempts = [], []

    def offline(*_args, **_kwargs):
        network_attempts.append(True)
        raise RuntimeError("Offline pix2tex probe cannot connect to the network")

    def no_clipboard(value):
        clipboard_attempts.append(len(value))

    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    socket.create_connection = offline
    import numpy as np
    import torch
    from PIL import Image
    from munch import Munch
    import pix2tex
    if args.pipeline == "reference":
        from pix2tex.cli import LatexOCR
        import pandas.io.clipboard as clipboard
        clipboard.copy = no_clipboard
    else:
        from pix2tex_core import CoreOCR as LatexOCR

    load = torch.load
    torch.load = lambda *values, **options: load(*values, **{**options, "weights_only": True, "mmap": True})
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but this runtime/device does not support CUDA")
    model_directory = Path(pix2tex.__file__).parent / "model"
    model = LatexOCR(Munch(config=str(model_directory / "settings/config.yaml"),
                           checkpoint=str(root / "weights.pth"), no_cuda=args.device == "cpu",
                           no_resize=False))
    assert model.args.device == args.device and model.image_resizer is not None
    init_ms = round((time.monotonic() - started) * 1000)
    if args.greedy:
        @torch.no_grad()
        def greedy(image, **_options):
            context = model.model.encoder(image)
            ids = torch.full((1, 1), model.args.bos_token, dtype=torch.int64, device=image.device)
            for _ in range(model.args.max_seq_len):
                logits = model.model.decoder.net(ids, mask=torch.ones_like(ids, dtype=torch.bool), context=context)[:, -1, :]
                next_id = logits.argmax(-1, keepdim=True)
                ids = torch.cat((ids, next_id), dim=-1)
                if next_id.item() == model.args.eos_token:
                    break
            return ids[:, 1:]
        model.model.generate = greedy
    generate, tokens, tensors = model.model.generate, [], []

    def capture(image, **options):
        tensors.append({"shape": list(image.shape),
                        "sha256": hashlib.sha256(image.detach().cpu().numpy().tobytes()).hexdigest()})
        output = generate(image, **options)
        tokens.append(output.detach().cpu().numpy().reshape(-1).tolist())
        return output

    model.model.generate = capture
    versions = {item.metadata["Name"]: item.version for item in importlib.metadata.distributions()}
    results = []
    payload = {"model": "pix2tex", "package": "0.1.4", "weightsRelease": "v0.0.1", "pipeline": args.pipeline, "greedy": args.greedy,
               "backend": args.device, "artifacts": ARTIFACTS, "versions": versions,
               "runnerSha256": digest(Path(__file__)),
               "coreSha256": digest(Path(__file__).with_name("pix2tex_core.py")),
               "configSha256": digest(model_directory / "settings/config.yaml"),
               "tokenizerSha256": digest(model_directory / "dataset/tokenizer.json"),
               "initializationMs": init_ms, "results": results, "networkAttempts": 0,
               "clipboardWrites": 0, "scope": "Generated fixtures; compatibility is not quality acceptance."}
    for sample in json.loads(cases.read_text(encoding="utf-8")):
        path = cases.parent / (sample["id"] + ".png")
        source_hash = digest(path)
        with Image.open(path) as image:
            width, height = image.size
            if max(width, height) > 8192 or width * height > 12000000:
                raise ValueError("Image exceeds the formula input limit")
            image.load()
            # Reset the official stochastic sampler for a reproducible fixture run.
            torch.manual_seed(42)
            np.random.seed(42)
            before = time.monotonic()
            text = model(image)
            elapsed = round((time.monotonic() - before) * 1000)
        generated = tokens[-1]
        assert digest(path) == source_hash
        assert len(generated) <= model.args.max_seq_len and generated[-1] == model.args.eos_token
        assert text and not network_attempts
        entry = {"id": sample["id"], "expected": sample["latex"], "latex": text,
                 "sourceSha256": source_hash, "dimensions": [width, height],
                 "milliseconds": elapsed,
                 "tokens": generated, "preprocessed": tensors[-1], "eos": True}
        results.append(entry)
        report.parent.mkdir(parents=True, exist_ok=True)
        payload["clipboardAttemptsBlocked"] = len(clipboard_attempts)
        report.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"id": sample["id"], "milliseconds": elapsed, "latex": text}), flush=True)
    assert len(clipboard_attempts) == (len(results) if args.pipeline == "reference" else 0) and not network_attempts


if __name__ == "__main__":
    main()
