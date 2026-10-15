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
    parser.add_argument("--golden-root", type=Path)
    args = parser.parse_args()
    cases, report = args.cases.resolve(), args.report.resolve()
    golden = args.golden_root.resolve() if args.golden_root else None
    if golden:
        golden.mkdir(parents=True, exist_ok=True)

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
            values = np.array(rgb.convert("L"), dtype=np.float64)
            color = Image.fromarray(np.stack([values * .8 + 50, values * .7 + 10, 255 - values * .9], axis=-1).astype(np.uint8))
            opacity = color.convert("RGBA")
            opacity.putalpha(Image.new("L", source.size, 128))
            variants = {"original": rgb, "dark": ImageOps.invert(rgb), "alpha": alpha,
                        "large": rgb.resize((rgb.width * 2, rgb.height * 2)),
                        "small": rgb.resize((max(8, rgb.width // 3), max(8, rgb.height // 3))),
                        "color": color, "constant-opacity": opacity}
            for label, image in variants.items():
                reference = reference_size(pad(image), [672, 192], [32, 32])
                candidate = minmax_size(pad(image), [672, 192], [32, 32])
                assert reference.size == candidate.size and reference.tobytes() == candidate.tobytes()
                a = test_transform(image=np.array(reference.convert("RGB")))["image"][:1].unsqueeze(0).numpy()
                b = tensor(candidate).numpy()
                assert np.array_equal(a, b), (sample["id"], label, float(np.abs(a - b).max()))
                record = {"id": sample["id"], "variant": label, "shape": list(a.shape),
                          "sha256": hashlib.sha256(a.tobytes()).hexdigest(), "bitExact": True}
                if golden:
                    prefix = sample["id"] + "-" + label
                    image.save(golden / (prefix + ".png"))
                    (golden / (prefix + ".raw")).write_bytes(reference.tobytes())
                    (golden / (prefix + ".f32")).write_bytes(a.tobytes())
                    record["image"] = prefix + ".png"
                    record["raw"] = prefix + ".raw"
                    record["tensor"] = prefix + ".f32"
                    record["resizes"] = []
                    for name, interpolation, width, height in [
                        ("linear", Image.Resampling.BILINEAR, min(672, reference.width * 2 + 3), min(192, reference.height * 2 + 3)),
                        ("lanczos", Image.Resampling.LANCZOS, max(1, reference.width // 2 + 1), max(1, reference.height // 2 + 1)),
                    ]:
                        resized = reference.resize((width, height), interpolation)
                        filename = prefix + "-" + name + ".raw"
                        (golden / filename).write_bytes(resized.tobytes())
                        record["resizes"].append({"filter": name, "width": width, "height": height, "raw": filename})
                records.append(record)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"passed": True, "cases": records}, indent=2), encoding="utf-8")
    print(f"pix2tex official preprocessing: {len(records)} bit-exact tensors")


if __name__ == "__main__":
    main()
