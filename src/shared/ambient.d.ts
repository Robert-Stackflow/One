declare module 'opencc-js' { export function Converter(options: { from: string; to: string }): (text: string) => string }
declare module 'loudness' { export function getVolume(): Promise<number>; export function setVolume(volume: number): Promise<void> }
declare module 'koffi' { const koffi: any; export default koffi }
interface Window { one: import('./types').OneAPI }
declare module '*.svg?url' { const url: string; export default url }

declare module "*?url" { const url:string; export default url; }
