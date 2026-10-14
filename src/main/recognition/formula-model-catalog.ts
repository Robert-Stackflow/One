import type {LocalModelDescriptor} from '../../shared/local-models';

export interface FormulaPreparedProfile {
  source:LocalModelDescriptor;
  recipe:string;
  output:{name:string;bytes:number;sha256:string};
}
const revision='3d46f557e3a1752f4bf81202395af3b5ecfadfd2';
const url=(name:string)=>`https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-S/resolve/${revision}/${name}`;
/** Sources are official Paddle weights; the ONNX output is produced locally. */
export const formulaPlusS:FormulaPreparedProfile={
  source:{id:'pp-formulanet-plus-s',revision,title:'PP-FormulaNet plus',size:'S',purpose:'formula',languages:['en'],
    weightLicense:{name:'Apache-2.0',source:`https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-S/tree/${revision}`},
    backends:['cpu','dml'],precision:'fp32',runtime:'formula-paddle2onnx',artifacts:[
      {name:'inference.json',role:'graph',url:url('inference.json'),bytes:506956,sha256:'01238434e33df83588e2627f350559b576e34551d2b2ffea148345032de56c00'},
      {name:'inference.pdiparams',role:'weights',url:url('inference.pdiparams'),bytes:256845006,sha256:'e464f94412feaa98f8791eacc84684f887b3569e30e80c52b8112e9cf7d4069b'},
      {name:'config.json',role:'config',url:url('config.json'),bytes:3951676,sha256:'ddf1f951ceeb10c2b9de3ae255b62de59299b1028f87878177e86c9604fe3610'},
    ]},recipe:'plus-s-opset19-scalar-v1',
  output:{name:'model.onnx',bytes:333913595,sha256:'bf3ecd1f6dcc2cdffdcad7421f44585df3578501f5552ed5122351c2e241c835'},
};
