const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {buildSync}=require('esbuild');

const output=path.resolve('work/current/proxy-connectivity');
let checks=0;
let phase='startup',finished=false;
process.on('beforeExit',()=>{if(!finished){console.error(`Incomplete proxy test: ${phase}; checks=${checks}`);process.exitCode=1;}});
const check=(value,message)=>{assert.ok(value,message);checks++;};
const equal=(value,expected,message)=>{assert.deepEqual(value,expected,message);checks++;};
function load(entry,stub){
 const file=path.join(output,path.basename(entry,'.ts')+'.cjs');
 const source=buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']}).outputFiles[0].text;
 const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
 const original=mod.require.bind(mod);mod.require=name=>name==='electron'?stub:original(name);mod._compile(source,file);return mod.exports;
}
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test){for(let n=0;n<100;n++){if(test())return;await delay(20);}throw Error('Local test condition timed out');}
async function main(){
 await fs.mkdir(output,{recursive:true});
 const engine=load('src/main/proxy-connectivity.ts');
 const received=[],sockets=new Set();let active=0,peak=0,slow=false,connectStatus=407;
 const server=http.createServer((req,res)=>{
  const parsed=new URL(req.url,'http://localhost');received.push({url:req.url,method:req.method});
  active++;peak=Math.max(peak,active);res.on('close',()=>active--);
  if(parsed.pathname==='/hang'||slow)return;
  if(parsed.pathname==='/redirect'){res.writeHead(302,{Location:'/status/204?token=redirect-secret'});res.end();return;}
  if(parsed.pathname==='/loop'){res.writeHead(302,{Location:'/loop'});res.end();return;}
  if(parsed.pathname==='/error'){req.socket.destroy();return;}
  setTimeout(()=>{res.writeHead(Number(parsed.pathname.split('/').pop())||200);res.end();},40);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
 server.on('connect',(req,socket)=>{
  received.push({url:new URL(`https://${req.url}/`).href,method:'CONNECT'});active++;peak=Math.max(peak,active);socket.once('close',()=>active--);
  if(!slow)setTimeout(()=>socket.end(`HTTP/1.1 ${connectStatus} Proxy Response\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`),40);
 });
 const port=await listen(server),base=`http://127.0.0.1:${port}`;
 const badTls=net.createServer(socket=>socket.end('HTTP/1.1 200 OK\r\n\r\n'));
 badTls.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
 const tlsPort=await listen(badTls);
 let resolution=async()=>`PROXY 127.0.0.1:${port}`;
 const {ProxyDiagnosticsService,routeFromElectron}=load('src/main/proxy-service.ts',{session:{defaultSession:{resolveProxy:url=>resolution(url)}}});
 const savedEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(all|https?|no)_proxy$/i.test(key)));
 for(const key of Object.keys(savedEnv))delete process.env[key];
 const events=[],service=new ProxyDiagnosticsService(value=>events.push(value));
 const site=url=>({id:'custom',name:'local',category:'test',url});
 try{
  phase='validation';equal(engine.normalizeProxyTarget('example.com/path'),'https://example.com/path');
  equal(engine.normalizeProxyTarget(`${base}/status/200?q=a#anchor`),`${base}/status/200?q=a`);
  for(const value of ['', 'file:///tmp/a','https://user:password@example.com/','https://example.com/a\nb','https://example.com:99999/']){assert.throws(()=>engine.normalizeProxyTarget(value));checks++;}
  for(const request of [null,{id:'bad',modes:['direct'],sites:['github']},{id:'test-x',modes:['direct','direct'],sites:['github']},{id:'test-x',modes:['proxy'],sites:['unknown']},{id:'test-x',modes:['direct'],sites:['github'],url:base}]){assert.throws(()=>engine.validateConnectivityRequest(request));checks++;}
  equal(routeFromElectron('DIRECT; PROXY 127.0.0.1:9999'),null,'PAC DIRECT has precedence');
  equal(routeFromElectron('PROXY 127.0.0.1:9999; DIRECT'),'http://127.0.0.1:9999');
  equal(routeFromElectron('SOCKS5 127.0.0.1:9999'),'socks5h://127.0.0.1:9999');
  for(const [code,status] of [[200,'ok'],[204,'ok'],[401,'restricted'],[403,'restricted'],[407,'restricted'],[429,'restricted'],[451,'restricted'],[404,'http-error'],[405,'http-error'],[500,'http-error']]){
   const result=await engine.checkProxySite(site(`${base}/status/${code}?token=input-secret`),'direct',null,new AbortController().signal);
   equal([result.status,result.http],[status,code]);check(Number.isFinite(result.latencyMs));check(!JSON.stringify(result).includes('input-secret'));
  }
  phase='redirects';const redirect=await engine.checkProxySite(site(`${base}/redirect`),'direct',null,new AbortController().signal);
  equal(redirect.http,204);check(redirect.effectiveUrl.includes('/status/204'));check(!JSON.stringify(redirect).includes('redirect-secret'));
  const loop=await engine.checkProxySite(site(`${base}/loop?token=loop-secret`),'direct',null,new AbortController().signal);
  equal(loop.failure,'redirect');check(!JSON.stringify(loop).includes('loop-secret'));
  const missing=await engine.checkProxySite(site(base),'proxy',null,new AbortController().signal);equal(missing.status,'unavailable');
  const refused=await engine.checkProxySite(site('http://127.0.0.1:1/?token=refused-secret'),'direct',null,new AbortController().signal);
  equal(refused.failure,'connect');check(!JSON.stringify(refused).includes('refused-secret'));
  const tls=await engine.checkProxySite(site(`https://127.0.0.1:${tlsPort}/?token=tls-secret`),'direct',null,new AbortController().signal);
  equal(tls.failure,'tls');check(!JSON.stringify(tls).includes('tls-secret'));
  phase='dns';const dns=await engine.checkProxySite(site('http://one-proxy-test.invalid/'),'direct',null,new AbortController().signal);equal(dns.failure,'dns');
  const timeoutStart=Date.now(),timeout=await engine.checkProxySite(site(`${base}/hang?token=timeout-secret`),'direct',null,new AbortController().signal);
  equal(timeout.failure,'timeout');check(Date.now()-timeoutStart<9000);check(!JSON.stringify(timeout).includes('timeout-secret'));
  check(received.every(item=>item.method==='HEAD'),'No response bodies are downloaded for connectivity checks');
  // Fake system routing points to a real local HTTP proxy: preset URLs never leave this machine.
  const ids=['chatgpt','codex','openai','huggingface','google','github','npm','stackoverflow','youtube','bilibili','qq','microsoft','wikipedia','cloudflare','tiktok','x','twitter','grok','gemini','instagram'];
  peak=0;
  phase='batch';const batch=await service.test({id:'test-batch',sites:ids,modes:['proxy']});
  equal(batch.results.length,20);equal(batch.targets.length,20);check(batch.results.every(result=>result.status==='restricted'&&result.http===407),'CONNECT proxy authentication is an HTTP restriction');check(peak<=4&&peak>1,`Bounded concurrency: ${peak}`);
  equal(events.filter(event=>event.id==='test-batch').length,20);
  check(received.some(item=>item.url==='https://twitter.com/'));check(received.some(item=>item.url==='https://x.com/'));
  for(const [code,status] of [[403,'restricted'],[500,'http-error']]){
   connectStatus=code;const refusedTunnel=await service.test({id:`test-tunnel-${code}`,sites:['github'],modes:['proxy']});
   equal([refusedTunnel.results[0].http,refusedTunnel.results[0].status],[code,status]);equal(refusedTunnel.results[0].responseFrom,'proxy');
  }
  connectStatus=407;
  const custom=await service.test({id:'test-custom',url:`${base}/status/204?token=custom-secret`,modes:['direct','proxy']});
  equal(custom.results.length,2);check(!JSON.stringify(custom).includes('custom-secret'));check(!JSON.stringify(events).includes('custom-secret'));
  phase='routes';resolution=async()=>'DIRECT; PROXY 127.0.0.1:1';
  const bypass=await service.test({id:'test-bypass',sites:['github'],modes:['proxy']});equal(bypass.results[0].status,'unavailable');
  resolution=async()=>{throw Error('PAC failed with private query token=route-secret');};
  const broken=await service.test({id:'test-broken-route',sites:['github'],modes:['proxy']});equal(broken.results[0].failure,'proxy');check(!JSON.stringify(broken).includes('route-secret'));
  resolution=()=>new Promise(()=>{});
  const pac=await service.test({id:'test-pac-timeout',sites:['github'],modes:['proxy']});equal(pac.results[0].status,'failed');
  resolution=async()=>`PROXY 127.0.0.1:${port}`;
  process.env.HTTPS_PROXY='http://127.0.0.1:1';
  const env=await service.test({id:'test-env',sites:['github'],modes:['proxy']});equal(env.results[0].failure,'connect');delete process.env.HTTPS_PROXY;
  phase='cancellation';slow=true;const before=received.length,start=Date.now();
  const running=service.test({id:'test-cancel',sites:ids,modes:['proxy']});
  await until(()=>received.length>=before+4);
  await assert.rejects(service.test({id:'test-overlap',sites:['github'],modes:['proxy']}),/已有检测/);checks++;
  equal(service.cancel('test-other'),false);equal(service.cancel('test-cancel'),true);
  const cancelled=await running;
  const cancelMs=Date.now()-start;
  equal(cancelled.cancelled,true);equal(cancelled.results.length,0);check(Date.now()-start<2000,'Cancel terminates live curl children');
  await until(()=>active===0);equal(received.length-before,4,'Cancel drops queued requests');
  check(!events.some(event=>event.id==='test-cancel'),'No late cancelled progress');
  slow=false;
  const recovered=await service.test({id:'test-recovered',url:base,modes:['direct']});equal(recovered.results[0].status,'ok');
  slow=true;const stopping=service.test({id:'test-stop',url:`${base}/hang`,modes:['direct']});await until(()=>active>0);service.stop();equal((await stopping).cancelled,true);await until(()=>active===0);
  await assert.rejects(service.test({id:'test-stopped',url:base,modes:['direct']}),/已关闭/);checks++;
  const report={result:'PASS',checks,presetTargets:batch.targets.length,peakConcurrency:peak,cancelMs,requests:received.length};
  await fs.writeFile(path.join(output,'backend-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  finished=true;
 }catch(error){console.error(`Proxy test failed at ${phase}:`,error);throw error;
 }finally{
  service.stop();for(const key of Object.keys(process.env))if(/^(all|https?|no)_proxy$/i.test(key))delete process.env[key];Object.assign(process.env,savedEnv);
  for(const socket of sockets)socket.destroy();await Promise.race([Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>badTls.close(resolve))]),delay(500)]);
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
