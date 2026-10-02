export interface LockProcess {token:string;pid:number;process:string;created:string;files:string[]}
export interface LocksmithState {running:boolean;targets:string[];processes:LockProcess[];checked:number;total:number;denied:number;timedOut:number;modulesUnavailable:number;error:string;cancelled:boolean}
