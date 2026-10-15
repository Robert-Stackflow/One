/** Qualified local conversion; not registered in the model picker until managed preparation is available. */
export const pix2texNative={
  id:'pix2tex',revision:'v0.0.1-pix2tex014-native-v1',maxTokens:512,memoryMiB:2048,
  encoder:{name:'encoder.onnx',bytes:51620750,sha256:'138e8661375badad016db099e0aacc04c6b1518574b8b8130157eb2d118356ce'},
  decoder:{name:'decoder.onnx',bytes:50826904,sha256:'e72a11bb4c925a32b31061fc3c5dd4756cb2737208bcf51ed2e0fd1d19a20f61'},
  resizer:{name:'resizer.onnx',bytes:19498709,sha256:'a62849dfa2e9ed618247eeae9704cf0d724010d6a62b3abfcb9c519936c0f605'},
  tokenizer:{name:'tokenizer.json',bytes:24174,sha256:'1dc27b18d6a518d0d5ff3f4bb7bd98521fe80ad39e5b2a246d4109f1bb9d5019'},
} as const;
