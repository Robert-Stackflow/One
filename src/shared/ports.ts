export interface PortEntry { protocol:'TCP'|'UDP'; localAddress:string; localPort:number; remoteAddress:string; remotePort:number; state:string; pid:number; process:string }
export interface ServiceEntry { name:string; displayName:string; state:string; startMode:string; pid:number; path:string }
export interface PortSnapshot { captured:number; ports:PortEntry[]; services:ServiceEntry[] }
