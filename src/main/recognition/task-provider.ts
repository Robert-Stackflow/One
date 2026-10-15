import type {OneAIService} from '../ai-service';
import type {TranslationConnection,TranslationLanguage,TranslationResult} from '../../shared/recognition/translation';
import type {FormulaResult} from '../../shared/recognition/formula';
/** Only feature code supplies the owner; renderer receives no arbitrary-prompt execution method. */
export class RecognitionTaskProvider {
  constructor(private ai:OneAIService,private owner:()=>number){}
  translationBudget(connection:TranslationConnection){return connection.provider==='service'?this.ai.translators.assertReference(connection.serviceReference).maxCharacters:this.ai.taskTranslationBudget(connection.reference);}
  translationBatchSize(connection:TranslationConnection){return connection.provider==='service'?this.ai.translators.assertReference(connection.serviceReference).maxItems:32;}
  async translateBatch(connection:TranslationConnection,paragraphs:import('../../shared/ai-task').AITaskParagraph[],target:TranslationLanguage,signal:AbortSignal){
    if(connection.provider==='service'){if(!connection.serviceReference)throw Error('翻译服务引用无效');return this.ai.translateBatch(connection.serviceReference,this.owner(),paragraphs,target,signal);}
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
    if(connection.provider==='service'){if(!connection.serviceReference)throw Error('公式服务引用无效');return {...await this.ai.recognizeDedicatedFormula(connection.serviceReference,this.owner(),png,signal),revision:connection.revision};}
    if(!connection.reference)throw Error('AI 服务引用无效');
    const result=await this.ai.runTask({owner:this.owner(),reference:connection.reference,purpose:'formula',image:{name:'formula.png',png:png.toString('base64')}},signal);
    if(result.purpose!=='formula')throw Error('公式任务结果无效');return {text:result.text,revision:connection.revision,endpoint:'ai:'+connection.reference.profileId,model:result.model};
  }
}
