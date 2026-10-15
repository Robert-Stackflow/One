"""Minimal offline wrapper for official pix2tex 0.1.4 models and preprocessing.

Inference/minmax_size adapted from lukas-blecher/LaTeX-OCR (MIT); pad,
post_process, token2str and model implementations are imported unchanged.
Normalization matches albumentations 1.3.1's OpenCV path. No CLI, clipboard,
training transforms, network downloads or global working-directory changes.
"""
from pathlib import Path

import cv2
import numpy as np
import torch
import yaml
from munch import Munch
from PIL import Image
from tokenizers import Tokenizer
from timm.models.layers import StdConv2dSame
from timm.models.resnetv2 import ResNetV2

from pix2tex.models import get_model
from pix2tex.utils import pad, post_process, token2str


def minmax_size(image, maximum, minimum):
    ratios = [a / b for a, b in zip(image.size, maximum)]
    if any(value > 1 for value in ratios):
        image = image.resize(tuple((np.array(image.size) // max(ratios)).astype(int)), Image.BILINEAR)
    size = [max(a, b) for a, b in zip(image.size, minimum)]
    if size != list(image.size):
        padded = Image.new("L", size, 255)
        padded.paste(image, image.getbbox())
        image = padded
    return image


def tensor(image):
    rgb = np.array(image.convert("RGB"))
    rgb = cv2.cvtColor(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB)
    mean = np.array([0.7931] * 3, dtype=np.float32) * 255.0
    scale = np.reciprocal(np.array([0.1738] * 3, dtype=np.float32) * 255.0, dtype=np.float32)
    data = np.ascontiguousarray(rgb.astype(np.float32))
    cv2.subtract(data, np.array(mean.tolist() + [0], dtype=np.float64), data)
    cv2.multiply(data, np.array(scale.tolist() + [1], dtype=np.float64), data)
    return torch.from_numpy(data.transpose(2, 0, 1))[:1].unsqueeze(0)


class CoreOCR:
    def __init__(self, arguments):
        directory = Path(arguments.config).parent.parent
        params = yaml.safe_load(Path(arguments.config).read_text(encoding="utf-8"))
        self.args = Munch(params)
        self.args.update(vars(arguments))
        self.args.device = "cpu" if arguments.no_cuda else "cuda"
        self.args.max_dimensions = [self.args.max_width, self.args.max_height]
        self.args.min_dimensions = [self.args.min_width, self.args.min_height]
        self.args.wandb = False
        self.model = get_model(self.args)
        self.model.load_state_dict(torch.load(arguments.checkpoint, map_location=self.args.device,
                                             weights_only=True, mmap=True))
        self.model.eval()
        self.image_resizer = ResNetV2(layers=[2, 3, 3], num_classes=max(self.args.max_dimensions) // 32,
                                     global_pool="avg", in_chans=1, drop_rate=.05, preact=True,
                                     stem_type="same", conv_layer=StdConv2dSame).to(self.args.device)
        self.image_resizer.load_state_dict(torch.load(Path(arguments.checkpoint).parent / "image_resizer.pth",
                                                       map_location=self.args.device, weights_only=True, mmap=True))
        self.image_resizer.eval()
        self.tokenizer = Tokenizer.from_file(str(directory / "dataset/tokenizer.json"))

    def __call__(self, image):
        image = minmax_size(pad(image), self.args.max_dimensions, self.args.min_dimensions)
        with torch.inference_mode():
            source = image.convert("RGB").copy()
            ratio, width, height = 1, source.width, source.height
            for _ in range(10):
                height = int(height * ratio)
                image = pad(minmax_size(source.resize((width, height), Image.Resampling.BILINEAR if ratio > 1
                                                       else Image.Resampling.LANCZOS),
                                        self.args.max_dimensions, self.args.min_dimensions))
                data = tensor(image)
                width = (self.image_resizer(data.to(self.args.device)).argmax(-1).item() + 1) * 32
                if width == image.width:
                    break
                ratio = width / image.width
            tokens = self.model.generate(data.to(self.args.device), temperature=self.args.temperature)

        class Decoder:
            def decode(_self, values):
                return self.tokenizer.decode(values.tolist(), skip_special_tokens=False)

        return post_process(token2str(tokens, Decoder())[0])
