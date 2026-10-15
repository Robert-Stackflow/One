/** pix2tex MIT and timm 0.5.4 Apache-2.0 notices are retained under assets/licenses. */
export const PIX2TEX_RECIPE=String.raw`# Qualified pix2tex 0.1.4 CPU conversion. MIT notice: assets/licenses/pix2tex-LICENSE.txt.
import hashlib,json,socket,sys,shutil
from pathlib import Path

def offline(*args, **kwargs):
    raise RuntimeError('Formula model preparation cannot connect to the network')
socket.socket.connect=offline
socket.socket.connect_ex=offline
socket.create_connection=offline
import torch,onnx,yaml,pix2tex
from munch import Munch
from torch.nn import functional
from timm.models.layers import StdConv2dSame
from timm.models.layers.pool2d_same import MaxPool2dSame
from timm.models.resnetv2 import ResNetV2
from pix2tex.models import get_model


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

source,destination,options=Path(sys.argv[1]),Path(sys.argv[2]),json.loads(sys.argv[3])
fixed={'weights.pth':(102113875,'a63d9141c53d266cb682fb5a8bd83bd5cbe283145e0e78ebdc0f895195a1dfaa'),'image_resizer.pth':(19441973,'1c3820659985ad142b526490bb25c23d977176ac2073591b3bddada692718458')}
for name,(size,sha256) in fixed.items():
    path=source/name
    with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    assert path.stat().st_size==size and digest==sha256,'Fixed source checkpoint mismatch'
torch.set_num_threads(2)
torch.set_num_interop_threads(1)
package=Path(pix2tex.__file__).parent/'model'
args=Munch(yaml.safe_load((package/'settings/config.yaml').read_text(encoding='utf-8')))
assert (args.max_height,args.max_width,args.max_seq_len,args.num_tokens,args.channels,args.encoder_structure)==(192,672,512,8000,1,'hybrid')
args.device='cpu'
args.wandb=False
model=get_model(args)
model.load_state_dict(torch.load(source/'weights.pth',map_location='cpu',weights_only=True,mmap=True))
model.eval()
resizer=ResNetV2(layers=[2,3,3],num_classes=21,global_pool='avg',in_chans=1,drop_rate=.05,preact=True,stem_type='same',conv_layer=StdConv2dSame)
resizer.load_state_dict(torch.load(source/'image_resizer.pth',map_location='cpu',weights_only=True,mmap=True))
resizer.eval()
freeze(model.encoder)
freeze(resizer)
encoder=Encoder(model.encoder).eval()
step=Step(model.decoder.net).eval()
image=torch.linspace(-4.,1.,steps=32*672).reshape(1,1,32,672)
with torch.no_grad():context=encoder(image)
exports=[('encoder',encoder,(image,),['image'],['encoded'],{'image':{2:'height',3:'width'},'encoded':{1:'patches'}}),('decoder',step,(torch.ones((1,3),dtype=torch.int64),context),['ids','context'],['logits'],{'ids':{1:'tokens'},'context':{1:'patches'}}),('resizer',resizer,(image,),['image'],['logits'],{'image':{2:'height',3:'width'}})]
for name,network,values,input_names,output_names,dynamic in exports:
    path=destination/(name+'.onnx')
    with torch.no_grad():torch.onnx.export(network,values,path,input_names=input_names,output_names=output_names,dynamic_axes=dynamic,opset_version=17,dynamo=False)
    onnx.checker.check_model(path)
    with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    assert digest==options[name+'Sha256'],'Prepared '+name+' differs from fixed recipe'
    print('Prepared '+name,flush=True)
config=package/'dataset/tokenizer.json'
with config.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
assert digest==options['tokenizerSha256'],'Tokenizer differs from fixed package'
shutil.copyfile(config,destination/'tokenizer.json')
`;
