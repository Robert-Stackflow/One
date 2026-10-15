import type {Pix2TexPreparedProfile} from './formula-model-catalog';
/** Qualified native conversion and the fixed official source release. */
export const pix2texNative={
  id:'pix2tex',revision:'v0.0.1-pix2tex014-native-v1',maxTokens:512,memoryMiB:2048,
  encoder:{name:'encoder.onnx',bytes:51620750,sha256:'138e8661375badad016db099e0aacc04c6b1518574b8b8130157eb2d118356ce'},
  decoder:{name:'decoder.onnx',bytes:50826904,sha256:'e72a11bb4c925a32b31061fc3c5dd4756cb2737208bcf51ed2e0fd1d19a20f61'},
  resizer:{name:'resizer.onnx',bytes:19498709,sha256:'a62849dfa2e9ed618247eeae9704cf0d724010d6a62b3abfcb9c519936c0f605'},
  tokenizer:{name:'tokenizer.json',bytes:24174,sha256:'1dc27b18d6a518d0d5ff3f4bb7bd98521fe80ad39e5b2a246d4109f1bb9d5019'},
} as const;
export const pix2texPrepared:Pix2TexPreparedProfile={
  engine:'pix2tex',source:{id:pix2texNative.id,revision:pix2texNative.revision,title:'pix2tex',size:'v0.0.1',purpose:'formula',languages:['en'],
    weightLicense:{name:'MIT',source:'https://github.com/lukas-blecher/LaTeX-OCR/releases/tag/v0.0.1'},
    backends:['cpu','dml'],precision:'fp32',runtime:'formula-pix2tex-onnx',artifacts:[
      {name:'weights.pth',role:'weights',url:'https://github.com/lukas-blecher/LaTeX-OCR/releases/download/v0.0.1/weights.pth',bytes:102113875,sha256:'a63d9141c53d266cb682fb5a8bd83bd5cbe283145e0e78ebdc0f895195a1dfaa'},
      {name:'image_resizer.pth',role:'resizer',url:'https://github.com/lukas-blecher/LaTeX-OCR/releases/download/v0.0.1/image_resizer.pth',bytes:19441973,sha256:'1c3820659985ad142b526490bb25c23d977176ac2073591b3bddada692718458'},
    ]},recipe:'pix2tex014-opset17-alignedws-v1',modelName:'pix2tex',maxTokens:512,memoryMiB:2048,
  output:pix2texNative.encoder,config:pix2texNative.tokenizer,decoder:pix2texNative.decoder,resizer:pix2texNative.resizer,
  conversion:{memoryMiB:2048,encoderSha256:pix2texNative.encoder.sha256,decoderSha256:pix2texNative.decoder.sha256,resizerSha256:pix2texNative.resizer.sha256,tokenizerSha256:pix2texNative.tokenizer.sha256},
};
