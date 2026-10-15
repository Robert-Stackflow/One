import type {LocalModelDescriptor} from '../../shared/local-models';

export interface FormulaPreparedProfile {
  source:LocalModelDescriptor;
  recipe:string;
  modelName:string;
  maxTokens:number;
  memoryMiB:number;
  conversion:{memoryMiB:number;rawSha256:string;scalarNode:string;api?:boolean};
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
    ]},recipe:'plus-s-opset19-scalar-v1',modelName:'PP-FormulaNet_plus-S',maxTokens:1024,memoryMiB:2048,
  conversion:{memoryMiB:4096,rawSha256:'575353f72a804215329b128ed1b85e8de65fdb4b06730ac8e7954bae5c44e64d',scalarNode:'If.3'},
  output:{name:'model.onnx',bytes:333913595,sha256:'bf3ecd1f6dcc2cdffdcad7421f44585df3578501f5552ed5122351c2e241c835'},
};
const mediumRevision='712e6e2e4c313b1ea163be5c350127b82662c58d';
const mediumURL=(name:string)=>`https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-M/resolve/${mediumRevision}/${name}`;
export const formulaPlusM:FormulaPreparedProfile={
  source:{id:'pp-formulanet-plus-m',revision:mediumRevision,title:'PP-FormulaNet plus',size:'M',purpose:'formula',languages:['en','zh'],
    weightLicense:{name:'Apache-2.0',source:`https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-M/tree/${mediumRevision}`},
    backends:['cpu','dml'],precision:'fp32',runtime:'formula-paddle2onnx',measuredMemoryMiB:2778,artifacts:[
      {name:'inference.json',role:'graph',url:mediumURL('inference.json'),bytes:1130158,sha256:'8333a7f650766a748e273c550d278601dd19dfeee1c4b01038ff632f134d9884'},
      {name:'inference.pdiparams',role:'weights',url:mediumURL('inference.pdiparams'),bytes:617064962,sha256:'f16ef9b5c8227da70d3ec969a5195f4d62c1154427b883f4d6cff07633654041'},
      {name:'config.json',role:'config',url:mediumURL('config.json'),bytes:3951676,sha256:'aaa40c3c54b25b157c46f937043f2223874f01fc7e2060f3d1d5d08ffb9bc12f'},
    ]},recipe:'plus-m-opset19-scalar-v1',modelName:'PP-FormulaNet_plus-M',maxTokens:2560,memoryMiB:4096,
  conversion:{memoryMiB:6144,rawSha256:'1cad8bae0dc02c17bfb9a56221dba5f26c205180f8b798f0c22fba05e623e94b',scalarNode:'If.7',api:true},
  output:{name:'model.onnx',bytes:720109023,sha256:'2787955eda423df7d048926d0269a0e918c1866b31f75c7271d12577b50fa3c0'},
};
const baseRevision='0572450e501be9eb1b1cdb7e00fccf4b22fab4df';
const baseURL=(name:string)=>`https://huggingface.co/PaddlePaddle/PP-FormulaNet-S/resolve/${baseRevision}/${name}`;
export const formulaBaseS:FormulaPreparedProfile={
  source:{id:'pp-formulanet-s',revision:baseRevision,title:'PP-FormulaNet',size:'S',purpose:'formula',languages:['en'],
    weightLicense:{name:'Apache-2.0',source:`https://huggingface.co/PaddlePaddle/PP-FormulaNet-S/tree/${baseRevision}`},
    backends:['cpu','dml'],precision:'fp32',runtime:'formula-paddle2onnx',measuredMemoryMiB:1036,artifacts:[
      {name:'inference.json',role:'graph',url:baseURL('inference.json'),bytes:504505,sha256:'2c8fc31a94d461a7325fe06e8cbaa5db6c5658c490f74d3d6116defe8c859d6f'},
      {name:'inference.pdiparams',role:'weights',url:baseURL('inference.pdiparams'),bytes:231675001,sha256:'b6392296d16e2a9f414c0a751d7ccbd1bd9d8272b68aab72df1d3875f35a7489'},
      {name:'config.json',role:'config',url:baseURL('config.json'),bytes:3951671,sha256:'ea32742b976ba34711042cac4e46206f114067949448c2bd8dec60a44d3de1fb'},
    ]},recipe:'base-s-opset19-scalar-v1',modelName:'PP-FormulaNet-S',maxTokens:1024,memoryMiB:2048,
  conversion:{memoryMiB:4096,rawSha256:'a588f558afc23177bfdbf533904f5a2e0c02f3065d850d5844de0cf470f7939d',scalarNode:'If.3'},
  output:{name:'model.onnx',bytes:308743452,sha256:'fa840f4f486dbee62f2ef507fa2871702ab9746d6922024ef641db4ce08a6a69'},
};
// Preserve the initial local selection; new candidates require explicit selection.
export const formulaProfiles:readonly FormulaPreparedProfile[]=[formulaPlusS,formulaPlusM,formulaBaseS];
