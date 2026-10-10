export type ThemeLocationResult = {state:'success';latitude:number;longitude:number;accuracy:number} | {state:'denied'|'unavailable'|'timeout'|'cancelled';detail:string};
