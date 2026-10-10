export type ProxyMode='direct'|'proxy';
export interface ProxyEnvironment {scope:'进程'|'用户'|'系统';name:string;value:string}
export interface ProxyProcess {name:string;pid:number;path:string}
export interface ProxyAdapter {name:string;description:string;status:string;mac:string;index:number;addresses:string[];gateways:string[];dns:string[];virtual:boolean}
export interface ProxyConfiguration {environment:ProxyEnvironment[];windows:{enabled:boolean;server:string;pac:string;autoDetect:boolean;bypass:string;winHttp:string};processes:ProxyProcess[];adapters:ProxyAdapter[];error?:string}
export interface ProxyExit {mode:ProxyMode;status:'ok'|'failed'|'unavailable';ip?:string;country?:string;region?:string;city?:string;latitude?:number;longitude?:number;asn?:string;organization?:string;source?:string;detail?:string}
export interface ProxySite {id:string;name:string;category:string;url:string}
export type ProxyFailure='dns'|'connect'|'tls'|'timeout'|'redirect'|'proxy'|'network'|'http';
export interface ProxySiteResult {site:string;mode:ProxyMode;status:'ok'|'restricted'|'http-error'|'failed'|'unavailable';http?:number;latencyMs?:number;detail?:string;route?:string;url?:string;effectiveUrl?:string;failure?:ProxyFailure;responseFrom?:'proxy'}
export interface ProxyDiagnostics {created:number;configuration:ProxyConfiguration;exits:ProxyExit[];sites:ProxySiteResult[];proxyAvailable:boolean;cancelled?:boolean}
export interface ProxyConnectivityRequest {id:string;sites?:string[];url?:string;modes:ProxyMode[]}
export interface ProxyConnectivityReport {id:string;created:number;targets:ProxySite[];results:ProxySiteResult[];cancelled:boolean}
export const proxyDiagnosticsJob='diagnostics';
export type ProxyDiagnosticsProgress={kind:'exit';value:ProxyExit}|{kind:'site';value:ProxySiteResult}|{kind:'connectivity';id:string;value:ProxySiteResult};
export const proxySites:ProxySite[]=[
 {id:'chatgpt',name:'ChatGPT',category:'AI',url:'https://chatgpt.com/'},
 {id:'grok',name:'Grok',category:'AI',url:'https://grok.com/'},
 {id:'gemini',name:'Gemini',category:'AI',url:'https://gemini.google.com/'},
 {id:'codex',name:'Codex',category:'AI',url:'https://developers.openai.com/codex'},
 {id:'openai',name:'OpenAI API',category:'AI',url:'https://api.openai.com/v1/models'},
 {id:'huggingface',name:'Hugging Face',category:'AI',url:'https://huggingface.co/'},
 {id:'google',name:'Google',category:'搜索与服务',url:'https://www.google.com/generate_204'},
 {id:'github',name:'GitHub',category:'开发',url:'https://github.com/'},
 {id:'npm',name:'npm',category:'开发',url:'https://www.npmjs.com/'},
 {id:'stackoverflow',name:'Stack Overflow',category:'开发',url:'https://stackoverflow.com/'},
 {id:'youtube',name:'YouTube',category:'视频与社交',url:'https://www.youtube.com/'},
 {id:'tiktok',name:'TikTok',category:'视频与社交',url:'https://www.tiktok.com/'},
 {id:'x',name:'X',category:'视频与社交',url:'https://x.com/'},
 {id:'twitter',name:'Twitter（旧地址）',category:'视频与社交',url:'https://twitter.com/'},
 {id:'instagram',name:'Instagram',category:'视频与社交',url:'https://www.instagram.com/'},
 {id:'bilibili',name:'哔哩哔哩',category:'视频与社交',url:'https://www.bilibili.com/'},
 {id:'qq',name:'QQ',category:'视频与社交',url:'https://www.qq.com/'},
 {id:'microsoft',name:'Microsoft',category:'常用',url:'https://www.microsoft.com/'},
 {id:'wikipedia',name:'Wikipedia',category:'常用',url:'https://www.wikipedia.org/'},
 {id:'cloudflare',name:'Cloudflare',category:'常用',url:'https://www.cloudflare.com/'}
];
