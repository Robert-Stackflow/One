import type {OneAIService} from '../ai-service';
import type {TranslationConnection,TranslationLanguage,TranslationResult} from '../../shared/recognition/translation';
import type {FormulaResult} from '../../shared/recognition/formula';
/** Only feature code supplies the owner; renderer receives no arbitrary-prompt execution method. */
export class RecognitionTaskProvider {
  constructor(private ai:OneAIService,private owner:()=>number){}
  translationBudget(connection:TranslationConnection){return this.ai.taskTranslationBudget(connection.reference);}
  async translateBatch(connection:TranslationConnection,paragraphs:import('../../shared/ai-task').AITaskParagraph[],target:TranslationLanguage,signal:AbortSignal){
    if(!connection.reference)throw Error('AI 服务引用无效');
    const result=await this.ai.runTask({owner:this.owner(),reference:connection.reference,purpose:'translation',target,paragraphs},signal);
    if(result.purpose!=='translation')throw Error('翻译任务结果无效');return {paragraphs:result.result.paragraphs,model:result.model};
  }
  async translate(connection:TranslationConnection,text:string,target:TranslationLanguage,signal:AbortSignal):Promise<TranslationResult>{
    if(!connection.reference)throw Error('AI 服务引用无效');
    const result=await this.ai.runTask({owner:this.owner(),reference:connection.reference,purpose:'translation',target,paragraphs:[{id:'source',text}]},signal);
    if(result.purpose!=='translation')throw Error('翻译任务结果无效');const paragraph=result.result.paragraphs[0];
    if(!paragraph||'error' in paragraph)throw Error(paragraph&&'error' in paragraph?paragraph.error:'服务未返回原文段落');
    return {source:text,text:paragraph.text,target,revision:connection.revision,endpoint:'ai:'+connection.reference.profileId,model:result.model};
  }
  async formula(connection:TranslationConnection,png:Buffer,signal:AbortSignal):Promise<FormulaResult>{
    if(!connection.reference)throw Error('AI 服务引用无效');
    const result=await this.ai.runTask({owner:this.owner(),reference:connection.reference,purpose:'formula',image:{name:'formula.png',png:png.toString('base64')}},signal);
    if(result.purpose!=='formula')throw Error('公式任务结果无效');return {text:result.text,revision:connection.revision,endpoint:'ai:'+connection.reference.profileId,model:result.model};
  }
}
