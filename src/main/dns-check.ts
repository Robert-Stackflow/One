import {Resolver,getServers} from 'node:dns/promises';
import {domainToASCII} from 'node:url';
import type {DnsCheckResult,DnsCheckReport} from '../shared/dns';

export function dnsDomain(value:unknown):string{
 if(typeof value!=='string'||value.length>253)throw new Error('请输入有效的域名');
 const raw=value.trim().replace(/\.$/,'');
 if(!raw||/[\s/:\\?#@]/.test(raw))throw new Error('请输入域名，例如 github.com');
 const domain=domainToASCII(raw).toLowerCase();
 if(!domain||domain.length>253||!domain.includes('.')||domain.split('.').some(label=>!label||label.length>63||!/^[-a-z0-9]+$/.test(label)||label.startsWith('-')||label.endsWith('-')))throw new Error('请输入有效的域名');
 return domain;
}

export async function checkDns(value:unknown):Promise<DnsCheckReport>{
 const domain=dnsDomain(value),servers=getServers().slice(0,4);
 if(!servers.length)throw new Error('系统没有配置 DNS 服务器');
 const results=await Promise.all(servers.map(async(server):Promise<DnsCheckResult>=>{
  const resolver=new Resolver({timeout:2500,tries:1});resolver.setServers([server]);const started=performance.now();
  const [v4,v6,cname]=await Promise.allSettled([resolver.resolve4(domain),resolver.resolve6(domain),resolver.resolveCname(domain)]);
  const addresses4=v4.status==='fulfilled'?v4.value:[],addresses6=v6.status==='fulfilled'?v6.value:[],aliases=cname.status==='fulfilled'?cname.value:[];
  const failure=[v4,v6,cname].find(result=>result.status==='rejected') as PromiseRejectedResult|undefined;
  return {server,latencyMs:Math.round(performance.now()-started),addresses4,addresses6,aliases,...(!addresses4.length&&!addresses6.length&&!aliases.length?{error:String((failure?.reason as Error)?.message||'没有返回记录').slice(0,180)}:{})};
 }));
 return {domain,created:Date.now(),results};
}
