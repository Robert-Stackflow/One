"""Compare the lean adapter against the official CLI/albumentations pipeline."""
import argparse
import hashlib
import json
import socket
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    cases, report = args.cases.resolve(), args.report.resolve()

    def offline(*_args, **_kwargs):
        raise RuntimeError("Preprocessing comparison cannot connect to the network")

    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    socket.create_connection = offline
    import numpy as np
    from PIL import Image, ImageOps
    from pix2tex.cli import minmax_size as reference_size
    from pix2tex.dataset.transforms import test_transform
    from pix2tex.utils import pad
    from pix2tex_core import minmax_size, tensor

    records = []
    for sample in json.loads(cases.read_text(encoding="utf-8")):
        with Image.open(cases.parent / (sample["id"] + ".png")) as source:
            rgb = source.convert("RGB")
            alpha = Image.new("RGBA", source.size, (0, 0, 0, 0))
            alpha.putalpha(ImageOps.invert(rgb.convert("L")))
            variants = {"original": rgb, "dark": ImageOps.invert(rgb), "alpha": alpha,
                        "large": rgb.resize((rgb.width * 2, rgb.height * 2)),
                        "small": rgb.resize((max(8, rgb.width // 3), max(8, rgb.height // 3)))}
            for label, image in variants.items():
                reference = reference_size(pad(image), [672, 192], [32, 32])
                candidate = minmax_size(pad(image), [672, 192], [32, 32])
                assert reference.size == candidate.size and reference.tobytes() == candidate.tobytes()
                a = test_transform(image=np.array(reference.convert("RGB")))["image"][:1].unsqueeze(0).numpy()
                b = tensor(candidate).numpy()
                assert np.array_equal(a, b), (sample["id"], label, float(np.abs(a - b).max()))
                records.append({"id": sample["id"], "variant": label, "shape": list(a.shape),
                                "sha256": hashlib.sha256(a.tobytes()).hexdigest(), "bitExact": True})
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"passed": True, "cases": records}, indent=2), encoding="utf-8")
    print(f"pix2tex official preprocessing: {len(records)} bit-exact tensors")


if __name__ == "__main__":
    main()
