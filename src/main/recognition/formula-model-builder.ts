import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {writeFile,rm} from 'node:fs/promises';
import {limitChildProcess} from '../capture/native';
import {localInference} from '../local-inference-scheduler';

/** Fixed converter and scalar contract; renderer input cannot supply Python or argv. */
const RECIPE=String.raw`import hashlib, sys
from pathlib import Path
from paddle2onnx.command import main
source, destination = Path(sys.argv[1]), Path(sys.argv[2])
raw = destination / "model.raw.onnx"
sys.argv = ["paddle2onnx", "--model_dir", str(source), "--model_filename", "inference.json", "--params_filename", "inference.pdiparams", "--save_file", str(raw), "--opset_version", "19"]
main()
if hashlib.file_digest(raw.open("rb"), "sha256").hexdigest() != "575353f72a804215329b128ed1b85e8de65fdb4b06730ac8e7954bae5c44e64d":
    raise ValueError("Unexpected FormulaNet export")
import onnx
model, changed = onnx.load(raw), 0
def visit(graph):
    global changed
    for node in list(graph.node):
        if node.name == "If.3":
            if node.op_type != "If": raise ValueError("Unexpected scalar branch")
            for attribute in node.attribute:
                if attribute.type != onnx.AttributeProto.GRAPH: continue
                branch = attribute.g
                if len(branch.output) != 1: raise ValueError("Unexpected branch outputs")
                value = branch.output[0]
                if value.type.tensor_type.elem_type != onnx.TensorProto.FLOAT or len(value.type.tensor_type.shape.dim): raise ValueError("Unexpected scalar type")
                shape, result = "one.scalar.shape." + attribute.name, "one.scalar.output." + attribute.name
                branch.node.extend([onnx.helper.make_node("Constant", [], [shape], value=onnx.helper.make_tensor("scalar_shape", onnx.TensorProto.INT64, [0], [])), onnx.helper.make_node("Reshape", [value.name, shape], [result])])
                value.name = result
                changed += 1
        for attribute in node.attribute:
            if attribute.type == onnx.AttributeProto.GRAPH: visit(attribute.g)
visit(model.graph)
encoded = model.SerializeToString()
if changed != 2 or hashlib.sha256(encoded).hexdigest() != "bf3ecd1f6dcc2cdffdcad7421f44585df3578501f5552ed5122351c2e241c835": raise ValueError("Formula recipe output differs")
output = destination / "model.onnx"
output.write_bytes(encoded)
onnx.checker.check_model(str(output))
`;
export interface FormulaBuildInput {executable:string;source:string;destination:string;signal:AbortSignal}
export async function buildFormulaModel(input:FormulaBuildInput){
  const client={owner:Symbol('formula-builder')};
  return localInference.run(client,input.signal,async()=>{
    input.signal.throwIfAborted();const script=join(input.destination,'_convert.py');await writeFile(script,RECIPE,{flag:'wx'});
    try{
      await new Promise<void>((resolve,reject)=>{
        const child=spawn(input.executable,['-B','-I',script,input.source,input.destination],{cwd:input.destination,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',POLYGRAPHY_AUTOINSTALL_DEPS:'0'}});
        let release:(()=>void)|undefined,error:unknown,output='';const capture=(bytes:Buffer)=>{output=(output+bytes.toString()).slice(-2000);};
        child.stdout.on('data',capture);child.stderr.on('data',capture);
        const abort=()=>{error=Error('公式模型准备已取消');child.kill();};
        const timer=setTimeout(()=>{error=Error('公式模型转换超时');child.kill();},300000);
        child.on('error',value=>{error=value;});
        child.once('spawn',()=>{try{release=limitChildProcess(child.pid!,4096);if(input.signal.aborted)abort();}catch(value){error=value;child.kill();}});
        input.signal.addEventListener('abort',abort,{once:true});
        child.once('close',code=>{clearTimeout(timer);input.signal.removeEventListener('abort',abort);release?.();error?reject(error):code===0?resolve():reject(Error('公式模型转换失败：'+output.trim().slice(-1200)));});
      });
      input.signal.throwIfAborted();
    }finally{await rm(script,{force:true});await rm(join(input.destination,'model.raw.onnx'),{force:true});}
  });
}
