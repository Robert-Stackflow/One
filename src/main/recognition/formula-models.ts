import {FormulaModelStore} from './formula-model-store';
import {formulaProfiles} from './formula-model-catalog';
import {FormulaRuntimeStore} from './formula-runtime-store';
import {formulaTorchRuntimeProfile} from './formula-torch-runtime-catalog';
import {join} from 'node:path';
import type {LocalModelProgress} from '../../shared/local-models';

/** Per-preset ownership and cancellation; presets of each engine share a leased conversion runtime. */
export class FormulaModels {
  private readonly stores:Map<string,FormulaModelStore>;
  private readonly torchRuntime:FormulaRuntimeStore;
  constructor(root:string,runtime:Pick<FormulaRuntimeStore,'state'|'install'|'acquire'>,transport:typeof fetch=fetch){
    this.torchRuntime=new FormulaRuntimeStore(join(root,'runtimes','torch'),transport,formulaTorchRuntimeProfile);
    this.stores=new Map(formulaProfiles.map(profile=>[profile.source.id,new FormulaModelStore(root,profile.engine==='pix2tex'?this.torchRuntime:runtime,{transport,profile,...(profile.engine==='pix2tex'?{runtimeProfile:formulaTorchRuntimeProfile}:{})})]));
  }
  private store(id:string){const store=this.stores.get(id);if(!store)throw Error('公式模型尚未适配');return store;}
  state(id:string){return this.store(id).state();}
  install(id:string,signal:AbortSignal,progress?:(value:LocalModelProgress)=>void,sources?:Record<string,string>,runtimeSources?:Record<string,string>){return this.store(id).install(signal,progress,sources,runtimeSources);}
  acquire(id:string,signal?:AbortSignal){return this.store(id).acquire(signal);}
  remove(id:string){return this.store(id).remove();}
  async stop(){await Promise.all([...this.stores.values()].map(store=>store.stop()));await this.torchRuntime.stop();}
}
