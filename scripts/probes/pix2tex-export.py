"""Export the official pix2tex encoder/decoder-step/resizer plus parity tensors.

Only an offline feasibility probe; application registration requires subsequent
native parity, bounded decoding, runtime preparation and quality verification.
"""
import argparse
import json
import runpy
import socket
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root, cases, output = args.model_root.resolve(), args.cases.resolve(), args.output.resolve()
    shared = runpy.run_path(str(Path(__file__).with_name("pix2tex-runtime.py")))
    for name, (size, sha256) in shared["ARTIFACTS"].items():
        path = root / name
        assert path.stat().st_size == size and shared["digest"](path) == sha256

    def offline(*_args, **_kwargs):
        raise RuntimeError("ONNX conversion cannot connect to the network")

    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    socket.create_connection = offline
    import numpy as np
    import onnx
    import torch
    import pix2tex
    from munch import Munch
    from PIL import Image
    from pix2tex_core import CoreOCR
    from timm.models.layers import StdConv2dSame
    from timm.models.layers.pool2d_same import MaxPool2dSame
    from torch.nn import functional as functional

    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    model = CoreOCR(Munch(config=str(Path(pix2tex.__file__).parent / "model/settings/config.yaml"),
                          checkpoint=str(root / "weights.pth"), no_cuda=True, no_resize=False))
    output.mkdir(parents=True, exist_ok=True)
    inputs, encoded, resized, records = [], [], [], []

    def capture_encoder(_module, values, result):
        inputs.append(values[0].detach().clone())
        encoded.append(result.detach().clone())

    def capture_resizer(_module, values, result):
        resized.append((values[0].detach().clone(), result.detach().clone()))

    hooks = [model.model.encoder.register_forward_hook(capture_encoder),
             model.image_resizer.register_forward_hook(capture_resizer)]

    def save(name, value):
        data = value.detach().cpu().numpy()
        path = output / (name + ".f32")
        path.write_bytes(data.tobytes())
        return {"file": path.name, "shape": list(data.shape), "sha256": shared["digest"](path)}

    class Step(torch.nn.Module):
        def __init__(self, network):
            super().__init__()
            self.network = network

        def forward(self, ids, context):
            return self.network(ids, mask=torch.ones_like(ids, dtype=torch.bool), context=context)[:, -1, :]

    class Encoder(torch.nn.Module):
        def __init__(self, network):
            super().__init__()
            self.network = network
            assert isinstance(network.head, torch.nn.Identity) and network.dist_token is None

        def forward(self, image):
            # Upstream einops.repeat freezes the position grid during tracing.
            # This equivalent tensor grid keeps both image axes dynamic.
            net = self.network
            value = net.patch_embed(image)
            value = torch.cat((net.cls_token.expand(image.shape[0], -1, -1), value), dim=1)
            rows = torch.arange(image.shape[2] // net.patch_size, device=image.device).reshape(-1, 1)
            columns = torch.arange(image.shape[3] // net.patch_size, device=image.device).reshape(1, -1)
            positions = (rows * (net.width // net.patch_size) + columns + 1).flatten()
            positions = torch.cat((torch.zeros(1, dtype=torch.int64, device=image.device), positions))
            value = net.pos_drop(value + net.pos_embed[:, positions])
            for block in net.blocks:
                value = block(value)
            return net.norm(value)

    step = Step(model.model.decoder.net).eval()
    with torch.inference_mode():
        for sample in json.loads(cases.read_text(encoding="utf-8")):
            inputs.clear()
            encoded.clear()
            resized.clear()
            torch.manual_seed(42)
            np.random.seed(42)
            with Image.open(cases.parent / (sample["id"] + ".png")) as image:
                text = model(image)
            prefix = sample["id"]
            assert len(inputs) == len(encoded) == 1 and 0 < len(resized) <= 10
            ids = torch.tensor([[1, 43, 17, 29, 31, 10, 21, 2] * 64], dtype=torch.int64)
            records.append({"id": prefix, "latex": text, "image": save(prefix + "-image", inputs[0]),
                            "encoded": save(prefix + "-encoded", encoded[0]),
                            "resizer": [{"image": save(f"{prefix}-resize-{i}-in", x),
                                         "logits": save(f"{prefix}-resize-{i}-out", y)} for i, (x, y) in enumerate(resized)],
                            "steps": [{"ids": ids[:, :count].tolist(),
                                       "logits": save(f"{prefix}-step-{count}", step(ids[:, :count], encoded[0]))}
                                      for count in ([1, 3, 8, 64, 512] if sample["id"] == "fraction" else [1, 3, 8])]})
        # Verify the full supported rectangle as well as real preprocessed
        # images. These are capacity tensors, not extra quality samples.
        for height, width in [(32, 32), (192, 672), (192, 32), (32, 672)]:
            prefix = f"boundary-{height}-{width}"
            data = torch.linspace(-4., 1., steps=height * width).reshape(1, 1, height, width)
            context = model.model.encoder(data)
            resize = model.image_resizer(data)
            records.append({"id": prefix, "capacityOnly": True, "image": save(prefix + "-image", data),
                            "encoded": save(prefix + "-encoded", context),
                            "resizer": [{"image": save(prefix + "-resize-in", data), "logits": save(prefix + "-resize-out", resize)}],
                            "steps": [{"ids": ids[:, :count].tolist(),
                                       "logits": save(f"{prefix}-step-{count}", step(ids[:, :count], context))}
                                      for count in [1, 3, 8]]})
    for hook in hooks:
        hook.remove()

    def aligned_padding(kernel, stride, dilation=(1, 1)):
        assert all(value in [1, 2] for value in stride) and tuple(dilation) == (1, 1)
        vertical, horizontal = [max(k - s, 0) for k, s in zip(kernel, stride)]
        return (horizontal // 2, horizontal - horizontal // 2, vertical // 2, vertical - vertical // 2)

    class FrozenConv(torch.nn.Module):
        def __init__(self, original):
            super().__init__()
            with torch.no_grad():
                value = functional.batch_norm(original.weight.reshape(1, original.out_channels, -1),
                                               None, None, training=True, momentum=0., eps=original.eps)
                self.register_buffer("weight", value.reshape_as(original.weight).clone())
                self.register_buffer("bias", None if original.bias is None else original.bias.detach().clone())
            self.pads = aligned_padding(original.kernel_size, original.stride, original.dilation) if original.same_pad else None
            self.stride, self.padding = original.stride, original.padding
            self.dilation, self.groups = original.dilation, original.groups

        def forward(self, value):
            if self.pads:
                value = functional.pad(value, self.pads)
            return functional.conv2d(value, self.weight, self.bias, self.stride, self.padding, self.dilation, self.groups)

    class FrozenPool(torch.nn.Module):
        def __init__(self, original):
            super().__init__()
            self.pads = aligned_padding(original.kernel_size, original.stride, original.dilation)
            self.kernel, self.stride, self.dilation, self.ceil_mode = original.kernel_size, original.stride, original.dilation, original.ceil_mode

        def forward(self, value):
            return functional.max_pool2d(functional.pad(value, self.pads, value=-float("inf")),
                                         self.kernel, self.stride, 0, self.dilation, self.ceil_mode)

    def freeze(network):
        # timm's ceil(Python float) in SAME padding otherwise crops larger
        # traced inputs to the example size. Official inputs are multiples of
        # 32, so every stride-2 padding is a fixed, equivalent asymmetric pad.
        for name, child in list(network.named_children()):
            if isinstance(child, StdConv2dSame):
                setattr(network, name, FrozenConv(child))
            elif isinstance(child, MaxPool2dSame):
                setattr(network, name, FrozenPool(child))
            else:
                assert not type(child).__name__.endswith("Same"), type(child).__name__
                freeze(child)

    freeze(model.model.encoder)
    freeze(model.image_resizer)
    encoder = Encoder(model.model.encoder).eval()
    with torch.inference_mode():
        for sample in records:
            image = torch.from_numpy(np.fromfile(output / sample["image"]["file"], dtype=np.float32).reshape(sample["image"]["shape"]))
            expected = np.fromfile(output / sample["encoded"]["file"], dtype=np.float32).reshape(sample["encoded"]["shape"])
            assert np.array_equal(encoder(image).numpy(), expected), sample["id"]
            for resize in sample["resizer"]:
                data = torch.from_numpy(np.fromfile(output / resize["image"]["file"], dtype=np.float32).reshape(resize["image"]["shape"]))
                expected = np.fromfile(output / resize["logits"]["file"], dtype=np.float32).reshape(resize["logits"]["shape"])
                assert np.array_equal(model.image_resizer(data).numpy(), expected), sample["id"]

    # Dynamic image sizes remain constrained by the official 32px padding and
    # maximum 672x192 input, and the decoder remains capped at 512 tokens.
    exports = [("encoder", encoder, (inputs[0],), ["image"], ["encoded"],
                {"image": {2: "height", 3: "width"}, "encoded": {1: "patches"}}),
               ("decoder", step, (torch.ones((1, 3), dtype=torch.int64), encoded[0]), ["ids", "context"], ["logits"],
                {"ids": {1: "tokens"}, "context": {1: "patches"}}),
               ("resizer", model.image_resizer, (resized[-1][0],), ["image"], ["logits"],
                {"image": {2: "height", 3: "width"}})]
    artifacts = []
    for name, network, values, input_names, output_names, dynamic in exports:
        path = output / (name + ".onnx")
        with torch.no_grad():
            torch.onnx.export(network, values, path, input_names=input_names, output_names=output_names,
                              dynamic_axes=dynamic, opset_version=17, dynamo=False)
        onnx.checker.check_model(path)
        artifacts.append({"name": path.name, "bytes": path.stat().st_size, "sha256": shared["digest"](path)})
        print(f"Exported {name}: {path.stat().st_size} bytes", flush=True)
    payload = {"model": "pix2tex-0.1.4-v0.0.1", "opset": 17, "artifacts": artifacts, "cases": records,
               "runnerSha256": shared["digest"](Path(__file__)),
               "coreSha256": shared["digest"](Path(__file__).with_name("pix2tex_core.py")),
               "torch": torch.__version__, "onnx": onnx.__version__, "qualityAccepted": False}
    (output / "manifest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
