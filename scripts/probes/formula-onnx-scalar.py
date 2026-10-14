"""Normalize the two declared scalar branches in the pinned plus-S export.

This is a guarded feasibility recipe, not a general ONNX graph repair tool.
It preserves model weights and numerical values; broader input parity is required
before registering a production preset.
"""
import argparse
import hashlib
from pathlib import Path

import onnx

SOURCE_SHA = "575353f72a804215329b128ed1b85e8de65fdb4b06730ac8e7954bae5c44e64d"
OUTPUT_SHA = "bf3ecd1f6dcc2cdffdcad7421f44585df3578501f5552ed5122351c2e241c835"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve() or digest(args.source) != SOURCE_SHA:
        raise ValueError("Unexpected export; source must remain unchanged")
    model = onnx.load(args.source)
    changed = 0

    def visit(graph):
        nonlocal changed
        for node in list(graph.node):
            if node.name == "If.3":
                if node.op_type != "If":
                    raise ValueError("Expected the pinned If.3 contract")
                for attribute in node.attribute:
                    if attribute.type != onnx.AttributeProto.GRAPH:
                        continue
                    branch = attribute.g
                    if len(branch.output) != 1:
                        raise ValueError("Unexpected branch output count")
                    value = branch.output[0]
                    if value.type.tensor_type.elem_type != onnx.TensorProto.FLOAT or len(value.type.tensor_type.shape.dim):
                        raise ValueError("Expected a declared scalar float output")
                    original = value.name
                    shape = "one.scalar.shape." + attribute.name
                    result = "one.scalar.output." + attribute.name
                    branch.node.extend([
                        onnx.helper.make_node("Constant", [], [shape], value=onnx.helper.make_tensor("scalar_shape", onnx.TensorProto.INT64, [0], [])),
                        onnx.helper.make_node("Reshape", [original, shape], [result]),
                    ])
                    value.name = result
                    changed += 1
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.GRAPH:
                    visit(attribute.g)

    visit(model.graph)
    if changed != 2:
        raise ValueError("Expected exactly two scalar branch outputs")
    encoded = model.SerializeToString()
    if hashlib.sha256(encoded).hexdigest() != OUTPUT_SHA:
        raise ValueError("Recipe output differs from the verified artifact")
    if not args.output.exists() or digest(args.output) != OUTPUT_SHA:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encoded)
    onnx.checker.check_model(str(args.output))
    print(f"Scalar branch outputs: {changed}; verified SHA-256: {OUTPUT_SHA}")


if __name__ == "__main__":
    main()
