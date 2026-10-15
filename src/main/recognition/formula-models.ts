import {FormulaModelStore} from './formula-model-store';
import {formulaProfiles} from './formula-model-catalog';
import type {FormulaRuntimeStore} from './formula-runtime-store';
import type {LocalModelProgress} from '../../shared/local-models';

/** Per-preset ownership and cancellation; all sizes share one leased conversion runtime. */
export class FormulaModels {
  private readonly stores:Map<string,FormulaModelStore>;
  constructor(root:string,runtime:Pick<FormulaRuntimeStore,'state'|'install'|'acquire'>,transport:typeof fetch=fetch){
    this.stores=new Map(formulaProfiles.map(profile=>[profile.source.id,new FormulaModelStore(root,runtime,{transport,profile})]));
  }
  private store(id:string){const store=this.stores.get(id);if(!store)throw Error('公式模型尚未适配');return store;}
  state(id:string){return this.store(id).state();}
  install(id:string,signal:AbortSignal,progress?:(value:LocalModelProgress)=>void,sources?:Record<string,string>,runtimeSources?:Record<string,string>){return this.store(id).install(signal,progress,sources,runtimeSources);}
  acquire(id:string,signal?:AbortSignal){return this.store(id).acquire(signal);}
  remove(id:string){return this.store(id).remove();}
  async stop(){await Promise.all([...this.stores.values()].map(store=>store.stop()));}
}
