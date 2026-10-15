/** Adapted from pix2tex 0.1.4, Copyright (c) 2021 Lukas Blecher.
 * MIT notice: assets/licenses/pix2tex-LICENSE.txt.
 */
import {formulaOutput} from '../../shared/recognition/formula';
export const pix2texOutputError=(message:string)=>Object.assign(Error(message),{kind:'output'});
const outputError=pix2texOutputError;
/** pix2tex's tokenizer has no byte decoder: concatenate vocabulary pieces, then restore Ġ. */
export function pix2texDecoder(config:unknown){
  const value=config as any,model=value?.model;if(value?.decoder!==null||!model?.vocab||!Array.isArray(value.added_tokens))throw Error('pix2tex 字典配置不兼容');
  const vocabulary=new Map<number,string>();for(const [word,id] of Object.entries(model.vocab)){if(typeof id!=='number'||!Number.isInteger(id)||id<0||id>=1175||!word||word.length>2000||vocabulary.has(id))throw Error('pix2tex 字典无效');vocabulary.set(id,word);}
  if(vocabulary.size!==1175||[0,1,2].some((id)=>vocabulary.get(id)!==['[PAD]','[BOS]','[EOS]'][id])||value.added_tokens.length!==3||new Set(value.added_tokens.map((item:any)=>item.id)).size!==3||value.added_tokens.some((item:any)=>item.special!==true||vocabulary.get(item.id)!==item.content))throw Error('pix2tex 字典不完整');
  return (ids:readonly number[])=>{
    if(!ids.length||ids.length>512||ids.at(-1)!==2)throw outputError('公式输出未完整结束，请裁剪后重试');
    let text='';for(const id of ids){if(!Number.isInteger(id)||!vocabulary.has(id))throw outputError('公式输出包含未知字符');if(id===2)break;if(id!==0&&id!==1)text+=vocabulary.get(id);}
    text=text.replace(/Ġ/g,' ').trim();
    // Match the fixed upstream post_process, including Unicode-aware Python \W/\d.
    text=text.replace(/(\\(?:operatorname|mathrm|text|mathbf)\s?\*? {.*?})/g,word=>word.replace(/ /g,''));
    const nonletter=String.raw`(?:[^\p{L}\p{N}_]|[_^\p{Nd}])`,letter='[a-zA-Z]',rules=[`(?!\\\\ )(${nonletter})\\s+?(${nonletter})`,`(?!\\\\ )(${nonletter})\\s+?(${letter})`,`(${letter})\\s+?(${nonletter})`].map(pattern=>new RegExp(pattern,'gu'));
    for(let pass=0;pass<64;pass++){let next=text;for(const rule of rules)next=next.replace(rule,'$1$2');if(next===text)return formulaOutput(text);text=next;}
    throw outputError('公式文本处理未能结束');
  };
}
